-- The waitlist (D-038): an email, one optional answer about how the person is paid today, the country Cloudflare
-- resolved from the request, and where they signed up. Only the web app's server route writes it, with the service
-- role; anon and authenticated get nothing, as for every table the first migration does not open on purpose.

create table public.waitlist (
  email text primary key
    constraint waitlist_email_format check (
      char_length(email) between 6 and 254
      and email = lower(email)
      and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    ),
  paid_with text
    constraint waitlist_paid_with_value check (paid_with in ('stablecoins', 'bank', 'both', 'payer')),
  country text
    constraint waitlist_country_format check (country ~ '^[A-Z]{2}$'),
  source text not null default 'site'
    constraint waitlist_source_format check (source ~ '^[a-z-]{1,32}$'),
  created_at timestamptz not null default now()
);
comment on table public.waitlist is
  'People who asked to hear from Sleeve (D-038). The email, lowercased, is the key, so joining twice changes nothing.';
comment on column public.waitlist.paid_with is
  'How the person is paid today, if they said: stablecoins, bank, both, or payer for someone who pays others.';
comment on column public.waitlist.country is 'The country Cloudflare resolved from the request, or null when unknown.';
comment on column public.waitlist.source is 'Where the form was opened from, for example footer.';

alter table public.waitlist enable row level security;

revoke all on table public.waitlist from anon, authenticated, service_role;
grant select, insert on table public.waitlist to service_role;
