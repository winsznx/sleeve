import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WaitlistForm } from './waitlist-form';

function stubFetch(response: Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function fill(email: string, paidWith = ''): void {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  if (paidWith !== '') fireEvent.change(screen.getByLabelText('How are you paid today?'), { target: { value: paidWith } });
  fireEvent.click(screen.getByRole('button', { name: 'Join the waitlist' }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WaitlistForm', () => {
  it('joins with the normalized email and the answer, then confirms', async () => {
    // #given the server accepts the entry
    const fetchMock = stubFetch(Response.json({ joined: true }, { status: 201 }));
    render(<WaitlistForm />);
    // #when someone fills the form
    fill(' Ada@Example.com ', 'bank');
    // #then one request carries the cleaned fields and the form turns into the confirmation
    expect(await screen.findByRole('status')).toHaveTextContent('You are on the list');
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Get your payment address now' })).toHaveAttribute('href', '/onboard');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/waitlist');
    expect(JSON.parse(String(init.body))).toEqual({ email: 'ada@example.com', paidWith: 'bank', source: 'site', company: '' });
  });

  it('asks for a real email before sending anything', () => {
    const fetchMock = stubFetch(Response.json({ joined: true }, { status: 201 }));
    render(<WaitlistForm />);
    fill('ada');
    expect(screen.getByText('Enter an email address like you@example.com.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the server's reason when the entry is refused, and keeps the form", async () => {
    stubFetch(Response.json({ error: 'The waitlist could not be saved. Try again in a minute.' }, { status: 502 }));
    render(<WaitlistForm />);
    fill('ada@example.com');
    expect(await screen.findByRole('alert')).toHaveTextContent('The waitlist could not be saved. Try again in a minute.');
    expect(screen.getByLabelText('Email')).toHaveValue('ada@example.com');
  });
});
