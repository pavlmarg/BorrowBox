import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AuthStore } from '../../core/auth/auth.store';
import { VerifyEmailNotice } from '../account-emails/verify-email-notice';
import { PersonProfile } from '../people/person-profile';

/**
 * `/profile`: my public profile exactly as others see it (ADR-0025), with
 * "Edit profile" leading to Settings, where the photo, name and bio change.
 */
@Component({
  selector: 'bb-profile-page',
  imports: [VerifyEmailNotice, PersonProfile],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (auth.user(); as user) {
      <bb-verify-email-notice class="verify" />
      <bb-person-profile [userId]="user.id" [own]="true" />
    }
  `,
  styles: `
    .verify {
      display: block;
      margin-bottom: 24px;
    }
  `,
})
export class ProfilePage {
  protected readonly auth = inject(AuthStore);
}
