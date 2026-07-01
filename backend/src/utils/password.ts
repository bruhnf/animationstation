import bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

export const hashPassword = (plain: string): Promise<string> => bcrypt.hash(plain, SALT_ROUNDS);

export const verifyPassword = (plain: string, hash: string): Promise<boolean> =>
  bcrypt.compare(plain, hash);

/**
 * A real (cost-12) bcrypt hash of a throwaway string. Used to equalize login
 * response time when the email doesn't match any user: we still run
 * verifyPassword against this so the bcrypt cost is paid either way, closing the
 * timing side-channel that would otherwise reveal which emails are registered.
 * Must be a well-formed hash — bcrypt.compare returns early on a malformed one,
 * which would defeat the purpose.
 */
export const DUMMY_PASSWORD_HASH = '$2b$12$0iIx2rc2YJz4kUdzqG.Ib.Sn1i3WKCO5v02IXSikBJBzJS6rJFZYK';
