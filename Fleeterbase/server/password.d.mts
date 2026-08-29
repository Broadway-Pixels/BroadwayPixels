export const PASSWORD_ITERATIONS: number;

export function passwordRecord(password: string): Promise<{
  hash: string;
  salt: string;
  iterations: number;
}>;

export function passwordMatches(password: string, hash: string, salt: string, iterations: number): Promise<boolean>;
