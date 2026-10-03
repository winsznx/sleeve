import { isDataLayerError } from '@/data/errors';

/** Why a rule write failed, in plain words, with what to do next. */
export function ruleFailureText(error: Error): string {
  if (!isDataLayerError(error)) return 'Try again in a moment.';
  switch (error.code) {
    case 'PasskeyCancelled':
      return 'The passkey prompt closed before you approved it. Nothing changed.';
    case 'PasskeyUnavailable':
      return "This browser could not use your passkey here. Open Sleeve on its own site and try again.";
    case 'NotSignedIn':
      return 'You are signed out. Sign in, then try again.';
    case 'InvalidRule':
      return 'One of the values is outside what the rule allows. Check the caps and the minimum buy.';
    case 'RuleNotActive':
      return 'Your rule is not active, so there is nothing to pause.';
    case 'RuleNotPaused':
      return 'Your rule is not paused, so there is nothing to resume.';
    case 'SourceUnavailable':
      return 'Sleeve could not reach Robinhood Chain. Try again in a moment.';
    default:
      return 'Try again in a moment.';
  }
}
