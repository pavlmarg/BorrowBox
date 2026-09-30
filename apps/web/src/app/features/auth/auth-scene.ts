import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  input,
  viewChild,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';

export type AuthVideo = 'register' | 'login';

const MEDIA = '/media/auth';

/** False where matchMedia is missing (tests, very old browsers). */
function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Full-screen auth layout. Desktop: a background video on one side and the
 * form on the other, sitting on a gradient that fades into the video.
 * Below 960 px: the video fills the screen behind a light, blurred scrim and
 * the form is centred. Reduced motion: the poster still instead of video.
 *
 * Videos live in public/media/auth (`<name>-wide.mp4` for desktop,
 * `<name>-tall.mp4` for phones, each with a `.jpg` poster); see CREDITS.md.
 */
@Component({
  selector: 'bb-auth-scene',
  imports: [TranslocoDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="scene"
      [class.form-right]="formSide() === 'right'"
      [class.tone-login]="video() === 'login'"
      [style.--poster-wide]="poster('wide')"
      [style.--poster-tall]="poster('tall')"
    >
      <div class="media" aria-hidden="true">
        @if (playVideo) {
          <video
            #player
            autoplay
            muted
            loop
            playsinline
            preload="auto"
            disablepictureinpicture
          >
            <source
              src="{{ source('wide') }}"
              type="video/mp4"
              media="(min-width: 960px)"
            />
            <source src="{{ source('tall') }}" type="video/mp4" />
          </video>
        }
      </div>

      <div class="panel">
        <div class="panel-inner" *transloco="let t">
          <header class="brand">
            <p class="name">{{ t('app.name') }}</p>
            <p class="tagline">{{ t('app.tagline') }}</p>
          </header>
          <ng-content />
        </div>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .scene {
      --tone: 234 245 255; /* register: light sky blue */
      --tone-soft: 246 251 255;
      --glow: 196 228 255;
      /* No panel: the whole screen is a soft tint and the video's edge
         fades into it, so nothing ends in a hard line. */
      background:
        radial-gradient(
          60% 70% at 12% 30%,
          rgb(var(--glow) / 0.55) 0%,
          transparent 70%
        ),
        linear-gradient(160deg, rgb(var(--tone-soft)) 0%, rgb(var(--tone)) 100%);
      min-height: 100vh;
      overflow: hidden;
      position: relative;
    }
    .scene.tone-login {
      --tone: 230 249 246; /* login: light aqua */
      --tone-soft: 245 253 251;
      --glow: 190 238 229;
      background:
        radial-gradient(
          60% 70% at 88% 30%,
          rgb(var(--glow) / 0.55) 0%,
          transparent 70%
        ),
        linear-gradient(200deg, rgb(var(--tone-soft)) 0%, rgb(var(--tone)) 100%);
    }

    .media {
      background: var(--poster-wide) 50% 30% / cover no-repeat;
      inset: 0 0 0 38%;
      position: absolute;
      /* Feathered edge towards the form: fully transparent at the video's
         inner edge, fully visible about a third of the way in. */
      mask-image: linear-gradient(
        90deg,
        transparent 0%,
        rgb(0 0 0 / 0.25) 12%,
        rgb(0 0 0 / 0.7) 24%,
        #000 38%
      );
    }
    .form-right .media {
      inset: 0 38% 0 0;
      mask-image: linear-gradient(
        270deg,
        transparent 0%,
        rgb(0 0 0 / 0.25) 12%,
        rgb(0 0 0 / 0.7) 24%,
        #000 38%
      );
    }
    video {
      display: block;
      height: 100%;
      object-fit: cover;
      object-position: 50% 30%;
      width: 100%;
    }

    .panel {
      align-items: center;
      box-sizing: border-box;
      display: flex;
      min-height: 100vh;
      padding: 96px 0 48px 6%;
      position: relative;
      width: 44%;
    }
    .form-right .panel {
      justify-content: flex-end;
      margin-left: auto;
      padding: 96px 6% 48px 0;
    }
    .panel-inner {
      max-width: 380px;
      width: 100%;
    }

    .brand {
      margin-bottom: 28px;
    }
    .name {
      color: var(--bb-sky-700);
      font: var(--mat-sys-headline-medium);
      font-weight: 800;
      letter-spacing: -0.6px;
      margin: 0;
    }
    .tone-login .name {
      color: #137a74;
    }
    .tagline {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
      margin: 4px 0 0;
    }

    /* Phones and small tablets: full-screen video behind a readable scrim. */
    @media (max-width: 959px) {
      .media,
      .form-right .media {
        background-image: var(--poster-tall);
        inset: 0;
        mask-image: none;
      }
      .panel,
      .form-right .panel {
        backdrop-filter: blur(6px) saturate(1.1);
        background: rgb(var(--tone) / 0.8);
        justify-content: center;
        margin: 0;
        padding: 88px 20px 32px;
        width: 100%;
      }
    }
  `,
})
export class AuthScene {
  readonly video = input.required<AuthVideo>();
  /** Which side the form sits on (desktop); the video takes the other. */
  readonly formSide = input<'left' | 'right'>('left');

  protected readonly playVideo = !prefersReducedMotion();
  private readonly player = viewChild<ElementRef<HTMLVideoElement>>('player');

  protected readonly poster = (size: 'wide' | 'tall') =>
    `url(${MEDIA}/${this.video()}-${size}.jpg)`;
  protected readonly source = (size: 'wide' | 'tall') =>
    `${MEDIA}/${this.video()}-${size}.mp4`;

  constructor() {
    // Some browsers only autoplay when `muted` is set as a property.
    effect(() => {
      const el = this.player()?.nativeElement;
      if (!el) return;
      el.muted = true;
      void el.play?.()?.catch(() => undefined);
    });
  }
}
