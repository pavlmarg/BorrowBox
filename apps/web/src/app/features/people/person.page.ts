import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { AuthStore } from '../../core/auth/auth.store';
import { PersonProfile } from './person-profile';

/**
 * `/users/:id`: anyone's public profile (ADR-0025), also for signed-out
 * visitors. Opening your own shows it as on `/profile`.
 */
@Component({
  selector: 'bb-person-page',
  imports: [PersonProfile],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<bb-person-profile [userId]="id()" [own]="own()" />`,
})
export class PersonPage {
  /** From the route. */
  readonly id = input.required<string>();

  private readonly auth = inject(AuthStore);
  protected readonly own = computed(() => this.auth.user()?.id === this.id());
}
