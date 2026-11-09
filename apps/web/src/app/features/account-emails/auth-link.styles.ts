/**
 * Shared look of the email-link pages (verify email, forgot and reset
 * password): the same title, form and status blocks as login and register,
 * inside the AuthScene, with its softer corners (`--bb-radius`, 8 px there).
 */
export const AUTH_LINK_STYLES = `
  .title {
    font: var(--mat-sys-headline-small);
    font-weight: 600;
    margin: 0;
  }
  .subtitle {
    color: var(--mat-sys-on-surface-variant);
    margin: 4px 0 20px;
  }
  .message {
    color: var(--mat-sys-on-surface-variant);
    margin: 6px 0 0;
    overflow-wrap: anywhere;
  }
  .progress {
    border-radius: 4px;
    margin-bottom: 12px;
    overflow: hidden;
  }
  .submit {
    height: 48px;
    margin-top: 4px;
  }
  .result {
    animation: rise var(--bb-fade) var(--bb-ease) both;
  }
  .icon {
    align-items: center;
    background: var(--bb-sky-100);
    border-radius: 50%;
    color: var(--bb-sky-700);
    display: inline-flex;
    height: 44px;
    justify-content: center;
    margin-bottom: 12px;
    width: 44px;
  }
  .icon.bad {
    background: color-mix(in srgb, var(--mat-sys-error) 10%, transparent);
    color: var(--mat-sys-error);
  }
  .icon svg {
    fill: none;
    height: 24px;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.8;
    width: 24px;
  }
  .actions {
    display: grid;
    gap: 12px;
    margin-top: 24px;
  }
  .actions .mat-mdc-button-base {
    height: 48px;
  }
  .sent {
    font-weight: 500;
    margin: 16px 0 0;
  }
  .switch {
    margin: 20px 0 0;
    text-align: center;
  }
  .spinner {
    animation: spin 1.1s linear infinite;
    display: block;
    height: 48px;
    margin-bottom: 20px;
    width: 48px;
  }
  .spinner circle {
    fill: none;
    stroke-width: 4;
  }
  .track {
    stroke: var(--bb-sky-200);
  }
  .arc {
    stroke: var(--bb-sky-700);
    stroke-dasharray: 32 126;
    stroke-linecap: round;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spinner,
    .result {
      animation: none;
    }
  }
`;
