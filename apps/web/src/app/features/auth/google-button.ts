import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoDirective } from '@jsverse/transloco';
import { authControllerGoogleStart } from '../../api/functions';
import { rememberReturnUrl } from '../../core/auth/return-url';

/**
 * A plain link, not an XHR: Google sign-in is a full-page redirect through the
 * gateway (`GET /api/auth/google`), which sets the signed state cookie.
 */
@Component({
  selector: 'bb-google-button',
  imports: [MatButtonModule, TranslocoDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a
      *transloco="let t"
      mat-stroked-button
      class="full-width"
      [href]="href"
      (click)="remember()"
    >
      {{ t(label()) }}
    </a>
  `,
})
export class GoogleButton {
  readonly returnUrl = input<string | null>(null);
  readonly label = input('auth.google');
  protected readonly href = authControllerGoogleStart.PATH;

  protected remember(): void {
    rememberReturnUrl(this.returnUrl());
  }
}
