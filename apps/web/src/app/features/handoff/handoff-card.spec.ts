import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTransloco } from '@jsverse/transloco';
import type { BookingViewResponse } from '../../api/models';
import { booking } from '../../../testing/bookings';
import { HandoffCard } from './handoff-card';

const H = 3_600_000;
const inHours = (h: number) => new Date(Date.now() + h * H).toISOString();

async function render(shown: BookingViewResponse) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideTransloco({
        config: { availableLangs: ['el', 'en'], defaultLang: 'en' },
      }),
    ],
  });
  const fixture = TestBed.createComponent(HandoffCard);
  fixture.componentRef.setInput('booking', shown);
  fixture.componentRef.setInput('now', Date.now());
  const answers: string[] = [];
  fixture.componentInstance.answer.subscribe((a) => answers.push(a));
  await fixture.whenStable();
  return { el: fixture.nativeElement as HTMLElement, answers };
}

describe('HandoffCard', () => {
  it('is empty while nothing about the handoff applies', async () => {
    const { el } = await render(booking({ status: 'REQUESTED' }));
    expect(el.textContent?.trim()).toBe('');
  });

  it('gives the renter the show button at return time', async () => {
    const { el } = await render(
      booking({ status: 'PICKED_UP', role: 'RENTER' }),
    );
    const go = el.querySelector('a.go');
    expect(go?.textContent).toContain('handoff.card.button.RETURN.SHOW');
    expect(go?.getAttribute('href')).toBe('/bookings/b-1/handoff?phase=RETURN');
  });

  it('emits the answer to "did it happen?" (the page confirms it)', async () => {
    const { el, answers } = await render(
      booking({
        status: 'PICKED_UP',
        role: 'LENDER',
        handoff: {
          ...booking().handoff,
          question: {
            phase: 'RETURN',
            myAnswer: null,
            otherAnswered: true,
            decideAt: inHours(60),
          },
        },
      }),
    );
    const no = [...el.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'handoff.question.no.RETURN',
    );
    no?.click();
    expect(answers).toEqual(['NO']);
  });
});
