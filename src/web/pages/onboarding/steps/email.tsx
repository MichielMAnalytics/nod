import { onboardingEmailProviders } from '../../../../shared/onboarding';
import type { StepProps } from '..';
import { PersonalConnection } from './personal-connection';

export function Email(props: StepProps) {
  return (
    <PersonalConnection
      {...props}
      kind="email"
      providerSlugs={onboardingEmailProviders}
      introduction="I can help you stay on top of your inbox."
      benefit="Find emails that need a reply, pull out next steps, and draft responses for you to review."
    />
  );
}
