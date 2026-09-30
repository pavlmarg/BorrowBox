import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Looping illustration for the auth pages: two neighbours in front of their
 * homes greet each other, one asks to borrow a toolbox, it is handed over and
 * a thank-you follows (10 s loop). Pure SVG + CSS: no video file, no request
 * to any third party. With reduced motion it shows one still frame.
 */
@Component({
  selector: 'bb-neighbours-scene',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      viewBox="0 0 560 440"
      role="img"
      [attr.aria-label]="label()"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id="bb-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#d6ecff" />
          <stop offset="1" stop-color="#f4faff" />
        </linearGradient>
        <linearGradient id="bb-house-a" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#9dd1ff" />
          <stop offset="1" stop-color="#7cbcf0" />
        </linearGradient>
        <linearGradient id="bb-house-b" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#b9e8f5" />
          <stop offset="1" stop-color="#94d4e8" />
        </linearGradient>
      </defs>

      <!-- Sky, sun, clouds -->
      <rect width="560" height="440" rx="8" fill="url(#bb-sky)" />
      <circle cx="470" cy="70" r="30" fill="#ffe7a3" />
      <g class="cloud cloud-a" fill="#ffffff" opacity="0.9">
        <rect x="60" y="52" width="90" height="22" rx="11" />
        <rect x="80" y="40" width="46" height="24" rx="12" />
      </g>
      <g class="cloud cloud-b" fill="#ffffff" opacity="0.8">
        <rect x="300" y="84" width="74" height="18" rx="9" />
        <rect x="318" y="74" width="36" height="20" rx="10" />
      </g>

      <!-- Two homes -->
      <g>
        <rect x="40" y="170" width="220" height="210" fill="url(#bb-house-a)" />
        <path d="M28 176 150 104 272 176z" fill="#4a90d0" />
        <rect x="70" y="210" width="44" height="40" rx="2" fill="#eaf6ff" />
        <rect x="186" y="210" width="44" height="40" rx="2" fill="#eaf6ff" />
        <rect x="124" y="290" width="52" height="90" rx="2" fill="#2f6fa8" />
        <circle cx="166" cy="338" r="3" fill="#ffd27a" />

        <rect
          x="300"
          y="170"
          width="220"
          height="210"
          fill="url(#bb-house-b)"
        />
        <path d="M288 176 410 104 532 176z" fill="#3aa3bf" />
        <rect x="330" y="210" width="44" height="40" rx="2" fill="#f0fbff" />
        <rect x="446" y="210" width="44" height="40" rx="2" fill="#f0fbff" />
        <rect x="384" y="290" width="52" height="90" rx="2" fill="#23758c" />
        <circle cx="394" cy="338" r="3" fill="#ffd27a" />
      </g>

      <!-- Ground -->
      <rect x="0" y="376" width="560" height="64" fill="#cfe9d8" />
      <rect x="0" y="376" width="560" height="6" fill="#b6dcc3" />

      <!-- Left neighbour (lends the toolbox) -->
      <g class="person person-left">
        <rect x="160" y="330" width="16" height="50" rx="3" fill="#1f3b57" />
        <rect x="184" y="330" width="16" height="50" rx="3" fill="#1f3b57" />
        <rect x="152" y="250" width="56" height="90" rx="10" fill="#4aa8f0" />
        <rect
          class="arm arm-left"
          x="200"
          y="262"
          width="14"
          height="58"
          rx="7"
          fill="#f1c7a5"
        />
        <rect x="146" y="262" width="14" height="56" rx="7" fill="#f1c7a5" />
        <circle cx="180" cy="224" r="24" fill="#f1c7a5" />
        <path
          d="M156 222c0-18 10-28 24-28s24 10 24 26c-8-8-20-10-30-8-8 2-14 6-18 10z"
          fill="#3b2f2f"
        />
        <circle cx="189" cy="226" r="2.4" fill="#2b2b2b" />
        <path
          d="M186 236q5 4 10 0"
          stroke="#2b2b2b"
          stroke-width="2"
          fill="none"
          stroke-linecap="round"
        />
      </g>

      <!-- Right neighbour (borrows it) -->
      <g class="person person-right">
        <rect x="360" y="330" width="16" height="50" rx="3" fill="#2d4a6b" />
        <rect x="384" y="330" width="16" height="50" rx="3" fill="#2d4a6b" />
        <rect x="352" y="250" width="56" height="90" rx="10" fill="#5cc8b4" />
        <rect
          class="arm arm-right"
          x="346"
          y="262"
          width="14"
          height="58"
          rx="7"
          fill="#c68b62"
        />
        <rect x="400" y="262" width="14" height="56" rx="7" fill="#c68b62" />
        <circle cx="380" cy="224" r="24" fill="#c68b62" />
        <circle cx="380" cy="194" r="11" fill="#1d1d1d" />
        <path
          d="M356 224c0-17 10-27 24-27s24 10 24 27c-6-10-16-14-24-14s-18 4-24 14z"
          fill="#1d1d1d"
        />
        <circle cx="371" cy="226" r="2.4" fill="#2b2b2b" />
        <path
          d="M364 236q5 4 10 0"
          stroke="#2b2b2b"
          stroke-width="2"
          fill="none"
          stroke-linecap="round"
        />
      </g>

      <!-- The toolbox, handed from left to right -->
      <g class="toolbox">
        <rect x="200" y="312" width="44" height="28" rx="3" fill="#ff9f43" />
        <rect x="200" y="312" width="44" height="8" rx="3" fill="#f07f1a" />
        <path
          d="M214 312v-7h16v7"
          fill="none"
          stroke="#b85a0f"
          stroke-width="3"
        />
        <rect x="218" y="322" width="8" height="5" rx="1" fill="#b85a0f" />
      </g>

      <!-- Speech bubbles -->
      <g class="bubble bubble-hello">
        <rect x="112" y="128" width="96" height="46" rx="8" fill="#ffffff" />
        <path d="M168 174l6 12 8-12z" fill="#ffffff" />
        <circle class="dot" cx="140" cy="151" r="5" fill="#4aa8f0" />
        <circle class="dot" cx="160" cy="151" r="5" fill="#4aa8f0" />
        <circle class="dot" cx="180" cy="151" r="5" fill="#4aa8f0" />
      </g>
      <g class="bubble bubble-ask">
        <rect x="352" y="128" width="96" height="46" rx="8" fill="#ffffff" />
        <path d="M378 174l6 12 8-12z" fill="#ffffff" />
        <rect x="385" y="146" width="26" height="17" rx="2" fill="#ff9f43" />
        <path
          d="M393 146v-4h10v4"
          fill="none"
          stroke="#b85a0f"
          stroke-width="2"
        />
        <text x="422" y="162" font-size="20" font-weight="700" fill="#1f6fb2">
          ?
        </text>
      </g>
      <g class="bubble bubble-thanks">
        <rect x="352" y="128" width="96" height="46" rx="8" fill="#ffffff" />
        <path d="M378 174l6 12 8-12z" fill="#ffffff" />
        <path
          d="M400 164c-10-7-15-11-15-17a7 7 0 0 1 15-3 7 7 0 0 1 15 3c0 6-5 10-15 17z"
          fill="#ff6b8a"
        />
      </g>
    </svg>
  `,
  styles: `
    :host {
      display: block;
    }
    svg {
      display: block;
      height: auto;
      width: 100%;
    }

    /* One 10 s timeline shared by every moving part. */
    .toolbox,
    .bubble,
    .arm,
    .person {
      animation-duration: 10s;
      animation-iteration-count: infinite;
      animation-timing-function: cubic-bezier(0.45, 0, 0.25, 1);
      transform-box: fill-box;
    }

    .person {
      animation-name: breathe;
      transform-origin: 50% 100%;
      animation-duration: 3.2s;
      animation-timing-function: ease-in-out;
    }
    .person-right {
      animation-delay: -1.6s;
    }
    @keyframes breathe {
      50% {
        transform: scaleY(1.012);
      }
    }

    .cloud {
      animation: float 14s ease-in-out infinite alternate;
    }
    .cloud-b {
      animation-duration: 18s;
    }
    @keyframes float {
      to {
        transform: translateX(28px);
      }
    }

    .bubble {
      opacity: 0;
      transform-origin: 50% 100%;
    }
    .bubble-hello {
      animation-name: hello;
    }
    .bubble-ask {
      animation-name: ask;
    }
    .bubble-thanks {
      animation-name: thanks;
    }
    @keyframes hello {
      2%,
      24% {
        opacity: 0;
        transform: scale(0.85);
      }
      6%,
      20% {
        opacity: 1;
        transform: scale(1);
      }
    }
    @keyframes ask {
      24%,
      46% {
        opacity: 0;
        transform: scale(0.85);
      }
      28%,
      42% {
        opacity: 1;
        transform: scale(1);
      }
    }
    @keyframes thanks {
      0%,
      70%,
      96% {
        opacity: 0;
        transform: scale(0.85);
      }
      74%,
      92% {
        opacity: 1;
        transform: scale(1);
      }
    }

    .dot {
      animation: typing 1s ease-in-out infinite;
    }
    .dot:nth-of-type(2) {
      animation-delay: 0.15s;
    }
    .dot:nth-of-type(3) {
      animation-delay: 0.3s;
    }
    @keyframes typing {
      50% {
        transform: translateY(-3px);
      }
    }

    /* Arms reach towards each other during the hand-over. */
    .arm-left {
      animation-name: reach-left;
      transform-origin: 50% 0;
    }
    .arm-right {
      animation-name: reach-right;
      transform-origin: 50% 0;
    }
    @keyframes reach-left {
      0%,
      46%,
      70%,
      100% {
        transform: rotate(0);
      }
      52%,
      64% {
        transform: rotate(-38deg);
      }
    }
    @keyframes reach-right {
      0%,
      52%,
      74%,
      100% {
        transform: rotate(0);
      }
      58%,
      68% {
        transform: rotate(38deg);
      }
    }

    /* The toolbox travels across, stays, then quietly returns for the next loop. */
    .toolbox {
      animation-name: hand-over;
    }
    @keyframes hand-over {
      0%,
      48% {
        opacity: 1;
        transform: translate(0, 0);
      }
      56% {
        transform: translate(64px, -26px);
      }
      64%,
      92% {
        opacity: 1;
        transform: translate(124px, 0);
      }
      96% {
        opacity: 0;
        transform: translate(124px, 0);
      }
      98% {
        opacity: 0;
        transform: translate(0, 0);
      }
      100% {
        opacity: 1;
        transform: translate(0, 0);
      }
    }

    /* Reduced motion: a still frame with the toolbox handed over and a thank-you. */
    @media (prefers-reduced-motion: reduce) {
      * {
        animation: none !important;
      }
      .toolbox {
        transform: translate(124px, 0);
      }
      .bubble-thanks {
        opacity: 1;
      }
    }
  `,
})
export class NeighboursScene {
  /** Accessible description of the picture (translated by the caller). */
  readonly label = input.required<string>();
}
