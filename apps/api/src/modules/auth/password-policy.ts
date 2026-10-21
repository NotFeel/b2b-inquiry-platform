import { PASSWORD_MIN_LENGTH } from '../../common/services/crypto.service';

export interface PasswordPolicyResult {
  valid: boolean;
  reasons: string[];
}

// Baseline password policy: length plus character-class diversity, and a check
// against trivial reuse of the username. Error reasons are stable keys that the
// admin UI translates (docs/07 §4).
export function checkPasswordPolicy(password: string, username?: string): PasswordPolicyResult {
  const reasons: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) reasons.push('password.tooShort');
  if (password.length > 200) reasons.push('password.tooLong');

  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
  if (classes < 3) reasons.push('password.notComplexEnough');

  if (username && password.toLowerCase().includes(username.toLowerCase())) {
    reasons.push('password.containsUsername');
  }

  return { valid: reasons.length === 0, reasons };
}
