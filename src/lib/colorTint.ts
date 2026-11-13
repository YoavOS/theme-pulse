/** "hsl(222, 82%, 64%)" → the same colour at alpha a. */
export const tint = (c: string, a: number) => c.replace("hsl(", "hsla(").replace(")", `, ${a})`);
