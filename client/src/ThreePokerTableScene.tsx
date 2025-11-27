import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { PlayerSeat } from './types';

type HandStage = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export interface SeatVisual {
  seatNumber: number;
  player: PlayerSeat | null;
  cards: (string | undefined)[];
  stack: number;
  isActive: boolean;
  isWinner: boolean;
  isButton: boolean;
}

interface ThreePokerTableSceneProps {
  seats: SeatVisual[];
  communityCards: string[];
  pot: number;
  stage: HandStage;
  showHoleCards: boolean;
  maxPlayers: number;
}

type SeatNode = {
  group: THREE.Group;
  pad: THREE.Mesh;
  cardMeshes: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>[];
  stackMesh: THREE.Mesh;
  highlight: THREE.Mesh;
  dealerChip: THREE.Mesh;
  avatar: THREE.Group;
};

type SceneState = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  communityCards: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>[];
  seatNodes: SeatNode[];
  potIndicator: THREE.Mesh;
  resizeObserver: ResizeObserver;
  animationId: number;
  resources: {
    cardGeometry: THREE.PlaneGeometry;
    chipGeometry: THREE.CylinderGeometry;
    dealerGeometry: THREE.CylinderGeometry;
  };
};

const disposeMaterial = (material: THREE.Material | THREE.Material[]) => {
  if (Array.isArray(material)) {
    material.forEach((mat) => mat.dispose());
  } else {
    material.dispose();
  }
};

const cardTextureCache = new Map<string, THREE.CanvasTexture>();

const suitMap: Record<string, { symbol: string; color: string }> = {
  H: { symbol: '♥', color: '#d34141' },
  D: { symbol: '♦', color: '#d34141' },
  S: { symbol: '♠', color: '#111111' },
  C: { symbol: '♣', color: '#111111' },
};

const getCardKey = (value: string, highlight: boolean) => `${value.toUpperCase()}-${highlight ? 'win' : 'base'}`;

type CanvasCtx = ReturnType<typeof document.createElement> extends {
  getContext(type: '2d'): infer T;
}
  ? NonNullable<T>
  : CanvasRenderingContext2D;

const drawCrown = (
  ctx: CanvasCtx,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
) => {
  const half = width / 2;
  ctx.beginPath();
  ctx.moveTo(x - half, y);
  ctx.lineTo(x - half * 0.65, y - height);
  ctx.lineTo(x - half * 0.25, y);
  ctx.lineTo(x, y - height * 1.1);
  ctx.lineTo(x + half * 0.25, y);
  ctx.lineTo(x + half * 0.65, y - height);
  ctx.lineTo(x + half, y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#2c1d08';
  ctx.stroke();

  ctx.fillStyle = '#fff4d6';
  [-0.45, 0, 0.45].forEach((offset) => {
    ctx.beginPath();
    ctx.arc(x + half * offset, y - height - 8, 10, 0, Math.PI * 2);
    ctx.fill();
  });
};

const drawFaceFigure = (ctx: CanvasCtx, rank: string, theme: { robe: string; trim: string; hair: string; skin: string }) => {
  const centerX = ctx.canvas.width / 2;
  const centerY = ctx.canvas.height / 2 + 10;

  ctx.fillStyle = theme.skin;
  ctx.beginPath();
  ctx.ellipse(centerX, centerY - 60, 45, 40, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = theme.hair;
  ctx.beginPath();
  ctx.ellipse(centerX, centerY - 75, 50, 35, 0, Math.PI, 0);
  ctx.fill();

  drawCrown(ctx, centerX, centerY - 110, 150, 55, theme.trim);

  ctx.fillStyle = theme.skin;
  ctx.beginPath();
  ctx.arc(centerX - 15, centerY - 65, 6, 0, Math.PI * 2);
  ctx.arc(centerX + 15, centerY - 65, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = theme.hair;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(centerX, centerY - 45, 15, 0, Math.PI);
  ctx.stroke();

  ctx.fillStyle = theme.robe;
  ctx.beginPath();
  ctx.moveTo(centerX - 90, centerY - 10);
  ctx.lineTo(centerX + 90, centerY - 10);
  ctx.lineTo(centerX + 60, centerY + 110);
  ctx.lineTo(centerX - 60, centerY + 110);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = theme.trim;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(centerX, centerY + 20, 70, Math.PI * 0.15, Math.PI - Math.PI * 0.15);
  ctx.stroke();

  if (rank === 'J') {
    ctx.strokeStyle = theme.trim;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(centerX - 50, centerY + 60);
    ctx.lineTo(centerX + 50, centerY + 60);
    ctx.stroke();
  } else if (rank === 'Q') {
    ctx.fillStyle = theme.trim;
    ctx.beginPath();
    ctx.arc(centerX - 40, centerY + 60, 18, 0, Math.PI * 2);
    ctx.fill();
  } else if (rank === 'K') {
    ctx.strokeStyle = theme.trim;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - 20);
    ctx.lineTo(centerX + 40, centerY + 40);
    ctx.moveTo(centerX, centerY - 20);
    ctx.lineTo(centerX - 40, centerY + 40);
    ctx.stroke();
  }
};

const suitThemes: Record<string, { base: string; border: string; accent: string; figure: { robe: string; trim: string; hair: string; skin: string } }> = {
  H: {
    base: '#ffe5e5',
    border: '#c11f2b',
    accent: '#f9c846',
    figure: { robe: '#c11f2b', trim: '#f9c846', hair: '#582707', skin: '#ffe0c2' },
  },
  D: {
    base: '#fff6e6',
    border: '#d75123',
    accent: '#f5d07a',
    figure: { robe: '#d75123', trim: '#f5d07a', hair: '#653215', skin: '#ffe8c7' },
  },
  C: {
    base: '#e4f4e7',
    border: '#1f4534',
    accent: '#c1a664',
    figure: { robe: '#1f4534', trim: '#c1a664', hair: '#2a1b0b', skin: '#f6e0c0' },
  },
  S: {
    base: '#e4ecff',
    border: '#1d2a57',
    accent: '#f0c45c',
    figure: { robe: '#1d2a57', trim: '#f0c45c', hair: '#2d1c0d', skin: '#f7e1c5' },
  },
};

const drawCardTexture = (value: string, highlight: boolean): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return new THREE.CanvasTexture(canvas);
  }

  const trimmed = value.trim().toUpperCase();
  const suitKey = trimmed.slice(-1);
  const rankRaw = trimmed.slice(0, -1) || trimmed;
  const rank = rankRaw === 'T' ? '10' : rankRaw;
  const suit = suitMap[suitKey] ?? { symbol: suitKey, color: '#111111' };
  const suitTheme = suitThemes[suitKey] ?? suitThemes.S;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const isFaceCard = ['J', 'Q', 'K', 'A'].includes(rank);
  const bgGradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  if (isFaceCard) {
    bgGradient.addColorStop(0, highlight ? '#fff2de' : suitTheme.base);
    bgGradient.addColorStop(1, highlight ? '#ffe2b0' : '#fffdf8');
  } else {
    bgGradient.addColorStop(0, `${suitTheme.base}`);
    bgGradient.addColorStop(1, '#ffffff');
  }
  ctx.fillStyle = bgGradient;
  ctx.lineWidth = 12;
  ctx.lineJoin = 'round';
  ctx.fillRect(12, 12, canvas.width - 24, canvas.height - 24);
  ctx.strokeStyle = highlight ? suitTheme.accent : suitTheme.border;
  ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);

  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.setLineDash([12, 8]);
  ctx.strokeRect(26, 26, canvas.width - 52, canvas.height - 52);
  ctx.setLineDash([]);

  ctx.fillStyle = suitTheme.border;
  ctx.font = 'bold 30px "Source Sans Pro", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(rank, 28, 30);
  ctx.fillStyle = suit.color;
  ctx.font = 'bold 32px "Source Sans Pro", sans-serif';
  ctx.fillText(suit.symbol, 28, 62);

  ctx.save();
  ctx.translate(canvas.width - 28, canvas.height - 30);
  ctx.rotate(Math.PI);
  ctx.fillStyle = suitTheme.border;
  ctx.font = 'bold 30px "Source Sans Pro", sans-serif';
  ctx.fillText(rank, 0, 0);
  ctx.fillStyle = suit.color;
  ctx.font = 'bold 32px "Source Sans Pro", sans-serif';
  ctx.fillText(suit.symbol, 0, 32);
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (isFaceCard) {
    const faceLabels: Record<string, string> = {
      J: 'JACK',
      Q: 'QUEEN',
      K: 'KING',
      A: 'ACE',
    };
    ctx.fillStyle = suitTheme.border;
    ctx.font = '700 30px "Inter", sans-serif';
    ctx.fillText(faceLabels[rank], canvas.width / 2, 60);

    if (rank === 'A') {
      ctx.fillStyle = suit.color;
      ctx.beginPath();
      ctx.arc(canvas.width / 2, canvas.height / 2 + 10, 70, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fefdf5';
      ctx.font = '900 90px "Playfair Display", serif';
      ctx.fillText('A', canvas.width / 2, canvas.height / 2 + 10);
    } else {
      drawFaceFigure(ctx, rank, suitTheme.figure);
    }

    ctx.font = 'bold 56px "Source Sans Pro", sans-serif';
    ctx.fillStyle = suit.color;
    ctx.fillText(suit.symbol, canvas.width - 50, canvas.height - 60);
    ctx.fillText(suit.symbol, 50, canvas.height - 60);
  } else {
    const pipLayouts: Record<string, Array<{ x: number; y: number }>> = {
      '2': [{ x: 0, y: -40 }, { x: 0, y: 40 }],
      '3': [{ x: 0, y: -50 }, { x: 0, y: 0 }, { x: 0, y: 50 }],
      '4': [
        { x: -40, y: -50 },
        { x: 40, y: -50 },
        { x: -40, y: 50 },
        { x: 40, y: 50 },
      ],
      '5': [
        { x: -40, y: -50 },
        { x: 40, y: -50 },
        { x: 0, y: 0 },
        { x: -40, y: 50 },
        { x: 40, y: 50 },
      ],
      '6': [
        { x: -40, y: -60 },
        { x: 40, y: -60 },
        { x: -40, y: 0 },
        { x: 40, y: 0 },
        { x: -40, y: 60 },
        { x: 40, y: 60 },
      ],
      '7': [
        { x: -40, y: -60 },
        { x: 40, y: -60 },
        { x: -40, y: -10 },
        { x: 40, y: -10 },
        { x: 0, y: -35 },
        { x: -40, y: 60 },
        { x: 40, y: 60 },
      ],
      '8': [
        { x: -40, y: -60 },
        { x: 40, y: -60 },
        { x: -40, y: -10 },
        { x: 40, y: -10 },
        { x: -40, y: 60 },
        { x: 40, y: 60 },
        { x: -40, y: 30 },
        { x: 40, y: 30 },
      ],
      '9': [
        { x: -40, y: -70 },
        { x: 40, y: -70 },
        { x: -40, y: -25 },
        { x: 40, y: -25 },
        { x: 0, y: -50 },
        { x: -40, y: 25 },
        { x: 40, y: 25 },
        { x: -40, y: 70 },
        { x: 40, y: 70 },
      ],
      '10': [
        { x: -40, y: -70 },
        { x: 40, y: -70 },
        { x: -40, y: -30 },
        { x: 40, y: -30 },
        { x: -40, y: 10 },
        { x: 40, y: 10 },
        { x: -40, y: 50 },
        { x: 40, y: 50 },
        { x: -40, y: 90 },
        { x: 40, y: 90 },
      ],
    };
    const layout = pipLayouts[rank] ?? [{ x: 0, y: 0 }];
    ctx.fillStyle = suit.color;
    ctx.font = 'bold 70px "Source Sans Pro", "Inter", sans-serif';
    layout.forEach((offset) => {
      ctx.fillText(suit.symbol, canvas.width / 2 + offset.x, canvas.height / 2 + offset.y);
    });
  }

  return new THREE.CanvasTexture(canvas);
};

const getCardTexture = (value: string, highlight = false): THREE.CanvasTexture => {
  const key = getCardKey(value, highlight);
  let texture = cardTextureCache.get(key);
  if (!texture) {
    texture = drawCardTexture(value, highlight);
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    cardTextureCache.set(key, texture);
  }
  return texture;
};

const getCardBackTexture = (() => {
  let texture: THREE.CanvasTexture | null = null;
  return () => {
    if (texture) {
      return texture;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#132243';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#1f3c7a';
      for (let y = 20; y < canvas.height; y += 30) {
        for (let x = 20; x < canvas.width; x += 30) {
          ctx.fillRect(x, y, 12, 12);
        }
      }
      ctx.strokeStyle = '#7aa5ff';
      ctx.lineWidth = 10;
      ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);
    }
    texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  };
})();

const buildTableGeometry = (): THREE.Group => {
  const group = new THREE.Group();

  const felt = new THREE.Mesh(
    new THREE.CircleGeometry(4.5, 96),
    new THREE.MeshStandardMaterial({
      color: 0x0c4a2f,
      roughness: 0.8,
      metalness: 0.1,
      emissive: 0x002713,
      emissiveIntensity: 0.2,
    }),
  );
  felt.rotation.x = -Math.PI / 2;
  felt.scale.set(1.7, 1, 1);
  felt.position.y = 0.05;
  group.add(felt);

  const rail = new THREE.Mesh(
    new THREE.TorusGeometry(4.6, 0.3, 32, 128),
    new THREE.MeshStandardMaterial({ color: 0x5b2f10, metalness: 0.3, roughness: 0.4 }),
  );
  rail.rotation.x = Math.PI / 2;
  rail.scale.set(1.55, 1, 1);
  group.add(rail);

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(5.2, 5.4, 0.6, 64),
    new THREE.MeshStandardMaterial({ color: 0x1a1208, roughness: 0.7 }),
  );
  base.position.y = -0.4;
  group.add(base);

  return group;
};

const avatarPalettes = ['#f97316', '#38bdf8', '#a855f7', '#f472b6', '#facc15', '#34d399', '#60a5fa', '#fb7185', '#c084fc', '#fde047'];

const buildSeatNodes = (
  maxPlayers: number,
  scene: THREE.Scene,
  cardGeometry: THREE.PlaneGeometry,
  chipGeometry: THREE.CylinderGeometry,
  dealerGeometry: THREE.CylinderGeometry,
): SeatNode[] => {
  return Array.from({ length: maxPlayers }, (_, seatNumber) => {
    const angle = (2 * Math.PI * seatNumber) / maxPlayers - Math.PI / 2;
    const radius = 4.4;
    const group = new THREE.Group();
    group.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    group.lookAt(0, 0, 0);

    const padMaterial = new THREE.MeshStandardMaterial({ color: 0x1b2621, metalness: 0.1, roughness: 0.9 });
    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(0.65, 32),
      padMaterial,
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.01;
    group.add(pad);

    const highlight = new THREE.Mesh(
      new THREE.CircleGeometry(0.75, 32),
      new THREE.MeshBasicMaterial({ color: 0x00ffd1, transparent: true, opacity: 0 }),
    );
    highlight.rotation.x = -Math.PI / 2;
    highlight.position.y = 0.009;
    group.add(highlight);

    const cardOffsets = [-0.28, 0.28];
    const cardMeshes = cardOffsets.map((offset, cardIdx) => {
      const mesh = new THREE.Mesh(
        cardGeometry,
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.4,
          metalness: 0.1,
          map: getCardBackTexture(),
        }),
      );
      mesh.position.set(offset, 0.14, 0.02 * cardIdx);
      group.add(mesh);
      return mesh;
    });

    const stackMesh = new THREE.Mesh(
      chipGeometry,
      new THREE.MeshStandardMaterial({ color: 0xff7043, emissive: 0x301208, emissiveIntensity: 0.3 }),
    );
    stackMesh.position.set(0, 0.15, -0.35);
    group.add(stackMesh);

    const avatarGroup = new THREE.Group();
    const avatarColor = avatarPalettes[seatNumber % avatarPalettes.length];
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.2, 0.35, 24),
      new THREE.MeshStandardMaterial({ color: avatarColor, metalness: 0.2, roughness: 0.4 }),
    );
    body.position.y = 0.32;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 24, 24),
      new THREE.MeshStandardMaterial({ color: 0xfef3c7, metalness: 0.1, roughness: 0.7 }),
    );
    head.position.y = 0.57;
    avatarGroup.add(body, head);
    avatarGroup.visible = false;
    group.add(avatarGroup);

    const dealerChip = new THREE.Mesh(
      dealerGeometry,
      new THREE.MeshStandardMaterial({ color: 0xfff2d5, emissive: 0x775f2a, emissiveIntensity: 0.3 }),
    );
    dealerChip.position.set(0, 0.18, 0.35);
    dealerChip.visible = false;
    group.add(dealerChip);

    scene.add(group);

    return {
      group,
      pad,
      cardMeshes,
      stackMesh,
      highlight,
      dealerChip,
      avatar: avatarGroup,
    };
  });
};

export function ThreePokerTableScene({
  seats,
  communityCards,
  pot,
  stage,
  showHoleCards,
  maxPlayers,
}: ThreePokerTableSceneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<SceneState | null>(null);
  const communityCountRef = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x06090f);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.1, 100);
    camera.position.set(0, 11, 2.5);
    camera.lookAt(0, 0, 0);

    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    const hemi = new THREE.HemisphereLight(0x1e5133, 0x080707, 0.6);
    const spotlight = new THREE.SpotLight(0xfff7d6, 1.2, 30, Math.PI / 6, 0.4);
    spotlight.position.set(0, 12, 4);
    scene.add(ambient, hemi, spotlight);

    const resources = {
      cardGeometry: new THREE.PlaneGeometry(0.9, 1.3),
      chipGeometry: new THREE.CylinderGeometry(0.15, 0.15, 0.3, 24),
      dealerGeometry: new THREE.CylinderGeometry(0.18, 0.18, 0.08, 24),
    };
    resources.cardGeometry.rotateX(-Math.PI / 2);

    const table = buildTableGeometry();
    scene.add(table);

    const communityGroup = new THREE.Group();
    scene.add(communityGroup);

    const communityMeshes = Array.from({ length: 5 }, (_, idx) => {
      const mesh = new THREE.Mesh(
        resources.cardGeometry,
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.2,
          metalness: 0.1,
          map: getCardBackTexture(),
        }),
      );
      mesh.position.set((idx - 2) * 0.95, 0.12, 0);
      mesh.visible = false;
      communityGroup.add(mesh);
      return mesh;
    });

    const seatNodes = buildSeatNodes(
      maxPlayers,
      scene,
      resources.cardGeometry,
      resources.chipGeometry,
      resources.dealerGeometry,
    );

    const potIndicator = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.35, 0.3, 32),
      new THREE.MeshStandardMaterial({
        color: 0xffd65c,
        emissive: 0x5a3c00,
        emissiveIntensity: 0.2,
      }),
    );
    potIndicator.position.set(0, 0.18, 1.35);
    scene.add(potIndicator);

    let animationId = 0;
    const animate = () => {
      communityMeshes.forEach((mesh) => {
        if (mesh.visible) {
          const targetY = (mesh.userData.targetY as number | undefined) ?? 0.12;
          mesh.position.y += (targetY - mesh.position.y) * 0.08;
        }
      });
      animationId = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    const resizeObserver = new ResizeObserver(() => {
      const { clientWidth, clientHeight } = container;
      renderer.setSize(clientWidth, clientHeight);
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
    });
    resizeObserver.observe(container);

    stateRef.current = {
      renderer,
      scene,
      camera,
      communityCards: communityMeshes,
      seatNodes,
      potIndicator,
      resizeObserver,
      animationId,
      resources,
    };

    return () => {
      const current = stateRef.current;
      if (current) {
        cancelAnimationFrame(current.animationId);
        current.resizeObserver.disconnect();
        current.renderer.dispose();
        current.resources.cardGeometry.dispose();
        current.resources.chipGeometry.dispose();
        current.resources.dealerGeometry.dispose();
        current.communityCards.forEach((mesh) => {
          mesh.geometry.dispose();
          disposeMaterial(mesh.material);
        });
        current.seatNodes.forEach((node) => {
          node.cardMeshes.forEach((mesh) => {
            disposeMaterial(mesh.material);
          });
          disposeMaterial(node.stackMesh.material);
          node.pad.geometry.dispose();
          disposeMaterial(node.pad.material);
          node.highlight.geometry.dispose();
          disposeMaterial(node.highlight.material);
          disposeMaterial(node.dealerChip.material);
          node.avatar.children.forEach((child) => {
            const mesh = child as THREE.Mesh;
            mesh.geometry.dispose?.();
            disposeMaterial(mesh.material as THREE.Material | THREE.Material[]);
          });
        });
        current.potIndicator.geometry.dispose();
        disposeMaterial(current.potIndicator.material);
        if (current.renderer.domElement.parentElement === container) {
          current.renderer.domElement.parentElement.removeChild(current.renderer.domElement);
        }
      }
      stateRef.current = null;
    };
  }, [maxPlayers]);

  useEffect(() => {
    const current = stateRef.current;
    if (!current) {
      return;
    }

    const backTexture = getCardBackTexture();
    const maxStack = Math.max(
      1,
      seats.reduce((acc, seat) => Math.max(acc, seat.stack || 0), 1),
    );

    seats.forEach((seat, index) => {
      const node = current.seatNodes[index];
      if (!node) {
        return;
      }
      if (!seat.player) {
        node.group.visible = true;
        node.avatar.visible = false;
        node.cardMeshes.forEach((mesh) => {
          mesh.visible = false;
        });
        node.stackMesh.visible = false;
        node.dealerChip.visible = false;
        return;
      }
      node.group.visible = true;
      node.avatar.visible = true;
      node.dealerChip.visible = seat.isButton;

      const stackRatio = Math.min(1.8, seat.stack / maxStack);
      node.stackMesh.visible = seat.stack > 0;
      node.stackMesh.scale.y = 0.4 + stackRatio * 2.2;
      node.stackMesh.position.y = 0.15 + (node.stackMesh.scale.y - 1) * 0.12;

      const highlightMaterial = node.highlight.material as THREE.MeshBasicMaterial;
      if (seat.isActive) {
        highlightMaterial.opacity = 0.45;
        highlightMaterial.color.set(0x2dd4ff);
      } else if (seat.isWinner) {
        highlightMaterial.opacity = 0.35;
        highlightMaterial.color.set(0xffe45c);
      } else {
        highlightMaterial.opacity = 0.12;
        highlightMaterial.color.set(0xffffff);
      }

      node.cardMeshes.forEach((mesh, cardIndex) => {
        mesh.visible = true;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (seat.cards[cardIndex]) {
          const texture = getCardTexture(seat.cards[cardIndex], seat.isWinner);
          mat.map = texture;
        } else {
          mat.map = backTexture;
        }
        mat.needsUpdate = true;
        if (seat.isActive) {
          mat.emissive = new THREE.Color(0x1b4fff);
          mat.emissiveIntensity = 0.25;
        } else {
          mat.emissive = new THREE.Color(0x000000);
          mat.emissiveIntensity = 0;
        }
      });
    });

    current.communityCards.forEach((mesh, index) => {
      const cardValue = communityCards[index];
      if (cardValue) {
        mesh.visible = true;
        mesh.userData.targetY = 0.12;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.map = getCardTexture(cardValue, false);
        mat.needsUpdate = true;
        if (index >= communityCountRef.current) {
          mesh.position.y = 0.65;
        }
      } else {
        mesh.visible = false;
      }
    });
    communityCountRef.current = communityCards.filter(Boolean).length;

    const seatTotal = seats.reduce((sum, seat) => sum + seat.stack, 0);
    const avgStack = seatTotal / Math.max(1, seats.filter((seat) => seat.player).length || 1);
    const normalizedPot = Math.min(2.5, avgStack > 0 ? pot / avgStack : pot);
    current.potIndicator.scale.y = 0.6 + normalizedPot * 0.45;
    const potMaterial = current.potIndicator.material as THREE.MeshStandardMaterial;
    potMaterial.emissiveIntensity = Math.min(0.9, normalizedPot * 0.4 + (stage === 'showdown' ? 0.3 : 0));
  }, [seats, communityCards, pot, showHoleCards, stage]);

  return <div className="poker-table-three" ref={containerRef} aria-label="Poker table visual" />;
}
