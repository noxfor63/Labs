/**
 * Курсор ленты поездок.
 *
 * Лента отсортирована по (departAt, id), поэтому курсор хранит обе
 * составляющие: сортировка только по departAt не различает поездки,
 * вышедшие в одну и ту же секунду, и страница может их потерять.
 */
export type TripCursor = {
  departAt: Date;
  id: string;
};

export function encodeCursor(cursor: TripCursor): string {
  return Buffer.from(`${cursor.departAt.getTime()}:${cursor.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): TripCursor | null {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const separator = decoded.indexOf(':');
  if (separator <= 0) {
    return null;
  }
  const millis = Number(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);
  if (!Number.isFinite(millis) || id === '') {
    return null;
  }
  return { departAt: new Date(millis), id };
}
