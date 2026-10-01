import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * Parent of register, login and the Google callback. Each page draws its own
 * full-screen AuthScene; route changes fade (styles.scss).
 */
@Component({
  selector: 'bb-auth-shell',
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<main><router-outlet /></main>`,
  styles: `
    :host {
      display: block;
      min-height: 100vh;
    }
  `,
})
export class AuthShell {}
