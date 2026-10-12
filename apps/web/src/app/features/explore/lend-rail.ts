import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { HowItWorks } from './how-it-works';

/**
 * Explore's right rail on wide screens: an invitation to lend, and how
 * BorrowBox works, for visitors who don't know it yet. Signed-out visitors
 * are sent to sign in first by the wizard's guard.
 */
@Component({
  selector: 'bb-lend-rail',
  imports: [TranslocoDirective, MatButtonModule, RouterLink, HowItWorks],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="lend"
      *transloco="let t"
      [attr.aria-label]="t('explore.lend.title')"
    >
      <h2>{{ t('explore.lend.title') }}</h2>
      <p>{{ t('explore.lend.text') }}</p>
      <a mat-flat-button class="cta" routerLink="/my-items/new">{{
        t('explore.lend.cta')
      }}</a>
    </section>
    <bb-how-it-works class="how" />
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 24px;
    }
    h2 {
      font: var(--mat-sys-title-medium);
      font-size: 18px;
      margin: 0 0 8px;
    }
    /* The one panel on Explore (asked for, for colour): brand blue, white
       text (5.3:1) and a white button. */
    .lend {
      background: var(--bb-sky-700);
      border-radius: var(--bb-radius);
      color: #fff;
      padding: 20px;
    }
    .lend p {
      color: rgb(255 255 255 / 0.9);
      font: var(--mat-sys-body-medium);
      margin: 0 0 16px;
    }
    /* Long labels (Greek) wrap inside the button instead of spilling out. */
    .cta {
      --mat-button-filled-container-color: #fff;
      --mat-button-filled-label-text-color: var(--bb-sky-700);
      --mat-button-filled-hover-state-layer-opacity: 0;
      --mat-button-filled-focus-state-layer-opacity: 0;
      transition:
        background-color 500ms var(--bb-ease),
        box-shadow 500ms var(--bb-ease),
        transform 500ms var(--bb-ease);
      height: auto;
      line-height: 20px;
      min-height: 40px;
      padding-bottom: 10px;
      padding-top: 10px;
      white-space: normal;
    }
    /* A slow, soft hover: pale blue, lifting a little. */
    .cta:hover {
      background-color: var(--bb-sky-100);
      box-shadow: 0 6px 16px rgb(0 0 0 / 0.18);
      transform: translateY(-2px);
    }
    .cta:focus-visible {
      outline: 3px solid #fff;
      outline-offset: 3px;
    }
    .how {
      border-top: 1px solid rgb(16 58 99 / 0.08);
      padding-top: 20px;
    }
  `,
})
export class LendRail {}
