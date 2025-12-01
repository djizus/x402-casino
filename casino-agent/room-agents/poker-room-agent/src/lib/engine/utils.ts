import { randomInt } from 'crypto';

export function shuffleInPlace<T>(array: T[]): void {
  for (let index = array.length - 1; index > 0; index -= 1) {
    const nextIndex = randomInt(index + 1);
    [array[index], array[nextIndex]] = [array[nextIndex], array[index]];
  }
}

export function nextOrWrap<T>(array: (T | null)[], currentIndex: number): number {
  let cursor = currentIndex;
  do {
    cursor += 1;
    if (cursor === array.length) {
      cursor = 0;
    }
  } while (array[cursor] === null);
  return cursor;
}

export function rotate<T>(array: T[], count: number): void {
  if (array.length === 0) {
    return;
  }
  const normalized = count - array.length * Math.floor(count / array.length);
  array.push(...array.splice(0, normalized));
}

export function unique<T>(array: T[], predicate: (first: T, second: T) => boolean = (first, second) => first !== second): T[] {
  if (array.length === 0) {
    return [];
  }
  return array.slice(1).reduce<T[]>((acc, item) => {
    if (predicate(acc[acc.length - 1], item)) {
      acc.push(item);
    }
    return acc;
  }, [array[0]]);
}

export function findIndexAdjacent<T>(array: T[], predicate: (first: T, second: T) => boolean): number {
  if (array.length < 2) {
    return -1;
  }
  let first = array[0];
  for (let index = 1; index < array.length; index += 1) {
    const second = array[index];
    if (predicate(first, second)) {
      return index - 1;
    }
    first = second;
  }
  return -1;
}

export function findMax<T>(array: T[], compare: (a: T, b: T) => number): T {
  if (array.length === 0) {
    throw new Error('Cannot find max of empty array');
  }
  const clone = array.slice();
  clone.sort(compare);
  return clone[0];
}
