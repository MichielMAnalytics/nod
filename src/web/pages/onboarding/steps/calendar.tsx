import type { Connection } from '../../../../shared/contracts';
import {
  onboardingCalendarProviders,
  onboardingEmailProviders,
} from '../../../../shared/onboarding';
import type { StepProps } from '..';
import { PersonalConnection } from './personal-connection';

function introduction(accounts: Connection[]) {
  return accounts.some((account) => onboardingEmailProviders.some((slug) => account.slug === slug))
    ? 'Your email is connected. Shall we connect your calendar too?'
    : 'Want to connect your calendar?';
}

export function Calendar(props: StepProps) {
  return (
    <PersonalConnection
      {...props}
      kind="calendar"
      providerSlugs={onboardingCalendarProviders}
      introduction={introduction}
      benefit="See what’s coming up, find time for meetings, and plan work around your schedule."
    />
  );
}
