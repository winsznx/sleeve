# Session calendar rules for 2026 and 2027

Research for build component 2, the SessionCalendar library (PRD sections 7.3, 7.4, 11 and 13). It answers when the market reference behind each launch ticker is live, so that a buy or sell only runs in session. Sources were read on Friday 2 October 2026 between 14:52 and 15:37 UTC. There is no Solidity here. The raw issuer API records are in docs/research/assets-api/.

How to read the quotes. Text in a quote block, or in a fenced block marked `text`, is copied from the source named next to it. Whitespace runs are collapsed. Markdown link targets, bold markers and backticks from the source are dropped, and table cells are shown with pipes between them. Quotes keep the source's own characters, including the en dashes in Chainlink's and Robinhood's tables, one em dash in NYSE's table and one in an old Chainlink note. Prose outside quotes follows the repo style. Every quote line was checked by script against the downloaded copies (appendix E).

## 1. Rules to encode

R1. Time base. Convert a UTC timestamp to New York local time with the offset table in section 3. Every daylight-saving switch happens at 02:00 local on a Sunday, inside the weekend closure, so no open session ever spans a switch.

R2. The 24/5 session, type ALL_DAY. For each NYSE trading day D, the session is open from 20:00 New York time on the calendar day before D until 20:00 on D, or until 17:00 on D when D is an early-close day. The same rule point by point, for a timestamp with local date L and local time of day m:

```
if m >= 20:00:  open  <=>  L + 1 day is a trading day
else:           open  <=>  L is a trading day and m < close(L)
close(L) = 17:00 if L is an early-close day, else 20:00
trading day = Monday to Friday and not on the holiday list
```

R3. What R2 produces. The week runs from Sunday 20:00 to Friday 20:00 New York time with no daily break. A holiday removes the 24 hours from 20:00 on the evening before it to 20:00 on the holiday itself. An early-close day ends at 17:00 and the market stays closed until 20:00 on the evening before the next trading day.

R4. Full-day holidays, 20 dates. 2026: 1 Jan, 19 Jan, 16 Feb, 3 Apr, 25 May, 19 Jun, 3 Jul, 7 Sep, 26 Nov, 25 Dec. 2027: 1 Jan, 18 Jan, 15 Feb, 26 Mar, 31 May, 18 Jun, 5 Jul, 6 Sep, 25 Nov, 24 Dec.

R5. Early closes, 3 dates: Friday 27 Nov 2026, Thursday 24 Dec 2026, Friday 26 Nov 2027. The regular session ends at 13:00 and the 24/5 session at 17:00.

R6. Regular-hours session, type REGULAR, only if the library carries a second type: trading days, 09:30 to 16:00 New York time, 13:00 on early-close days.

R7. Per-ticker type. SPY, QQQ, NVDA and AAPL are all ALL_DAY, from the issuer's assets API (section 7) and Chainlink's own feed metadata (section 2).

R8. Boundaries are half open: open at the opening second, closed at the closing second. This is a recommended default, see Q4.

R9. Coverage is New York calendar years 2026 and 2027, which is 1767243600 (2026-01-01T05:00:00Z) up to but not including 1830315600 (2028-01-01T05:00:00Z). Q8 covers queries outside it.

The 107 open intervals that R2 gives for 2026 and 2027 are listed in section 10 as UTC integers and ISO strings, ready for table tests. The rule was checked three ways: the interval form and the point form agree on every minute of 2026 and 2027, the closed evenings match Blue Ocean ATS's published holiday table exactly, and every one of the 2,414 rounds the four launch feeds have posted since 21 June 2026 falls inside an open interval (section 8).

## 2. Weekly window for 24/5 tickers

The owner's statement holds: Sunday 20:00 to Friday 20:00 New York time, following US daylight saving time, with no daily break.

Chainlink states the hours on its Data Streams market-hours page (https://docs.chain.link/data-streams/market-hours, source file at commit 69488b2 https://github.com/smartcontractkit/documentation/blob/69488b2fc0072bcc4ed99107857e496978528f12/src/content/data-streams/market-hours.mdx, read 14:56 UTC). The overview table columns are asset class, weekly open, weekly close, daily breaks and bank holidays:

> 24/5 US Equities and ETFs | 20:00 Sun | 20:00 Fri | None | NYSE holiday calendar

> US Equities, FX Majors, Precious Metals Spot, and Commodities times are ET (Eastern Time) and follow US daylight saving time.

The 24/5 marketStatus rows on the same page:

```text
1 | Pre-market | 4:00am–9:30am Mon–Fri | Extended hours before regular trading session
2 | Regular hours | 9:30am–4:00pm Mon–Fri | Primary trading session with highest liquidity
3 | Post-market | 4:00pm–8:00pm Mon–Fri | Extended hours after regular trading session
4 | Overnight | 8:00pm–4:00am Sun evening–Fri morning | Overnight session with limited liquidity
5 | Closed | N/A | Market closed (weekends, holidays, or unexpected closures; ~8:00pm Fri–8:00pm Sun ET)
```

The onchain feeds Sleeve reads are Chainlink Data Feeds built on that 24/5 data (https://docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood, commit c068c6a):

> Robinhood tokenized equity feeds are configured as 24/5 tokenized equity feeds (regular, pre-market, post-market, and overnight sessions), where underlying liquidity and session data quality support it.

> Underlying Equity Market Price: Sourced from Chainlink's 24/5 equity price feeds, which aggregate data across regular, pre-market, post-market, and overnight trading sessions.

> These feeds do not have heartbeats during off-hours.

The shared tokenized equity page (https://docs.chain.link/data-feeds/tokenized-equity-feeds, commit 99765ab) gives the session table:

```text
Pre-Market | 04:00 – 09:30 | Rising | Increasing activity as regular hours approach
Regular Trading | 09:30 – 16:00 | Deep | Full liquidity, primary price discovery
Post-Market | 16:00 – 20:00 | Declining | Reduced liquidity, wider spreads
Overnight | 20:00 – 04:00 | Thin | Limited venues, potential for price spikes
Weekend | Fri 20:00 – Sun 20:00 | Zero | Traditional markets closed
```

That page's introduction labels the sessions "(Eastern Standard Time)". The market-hours page says the times follow daylight saving time, and the onchain record in section 8 shows every summer open at 20:00 EDT, so the label is loose and New York local time is right.

Chainlink's feed metadata for Robinhood Chain is the file behind the docs' address table (https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json, read 15:25 UTC, sha256 714038abef5e6290ce09d4f02279382ff0dcd36e573b8d745ba38d9d316bf776). Values read with jq for the launch feeds:

| name | proxyAddress | docs.marketHours | heartbeat | threshold |
| --- | --- | --- | --- | --- |
| Robinhood SPY / USD | 0x319724394D3A0e3669269846abE664Cd621f9f6A | us_equities_24/5 | 86400 | 0.5 |
| Robinhood QQQ / USD | 0x80901d846d5D7B030F26B480776EE3b29374C2ae | us_equities_24/5 | 86400 | 0.5 |
| Robinhood NVDA / USD | 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 | us_equities_24/5 | 86400 | 0.5 |
| Robinhood AAPL / USD | 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0 | us_equities_24/5 | 86400 | 0.5 |

The file holds 58 feeds. All 35 named "Robinhood ... / USD" or "Robinhood ...-USD" carry us_equities_24/5. The other 23 carry Crypto: 22 crypto assets, including USDG / USD at 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2, and one Robinhood token whose feed is a different kind. GLD / USD has assetName "SPDR Gold Shares • Robinhood Token", marketHours Crypto and attributeType dex_state_price, so it is a DEX-state price on crypto hours and not the 24/5 equity data (see Q2).

Robinhood's broker publishes the same window (https://robinhood.com/us/en/support/articles/24hour-market/, read 14:59 UTC):

> Robinhood 24 Hour Market is available from Sunday 8 PM ET through Friday 8 PM ET.

Robinhood's chain docs give no clock hours for the reference. The three pages named in the task were read in full. Building with Stock Tokens and Stock Token APIs contain no hours. Oracles and Price Feeds says only this (https://docs.robinhood.com/chain/oracles-and-price-feeds, read 14:52 UTC):

> Stock feeds update 24/5, following market hours.

I searched every page linked from the chain and RHJ sections of docs.robinhood.com for clock times. Apart from an approximate corporate-action pause on the RHJ corporate actions page (section 11), the only ones are the tokenization window on the Stock Tokens page, which governs minting and burning by market makers and not the price reference (https://docs.robinhood.com/chain/stock-tokens, read 14:54 UTC):

> Market makers can place orders to mint and burn Stock Tokens during the following window:

> Monday 02:00 CET/CEST – Saturday 02:00 CET/CEST

> (Subject to local daylight savings schedules. Outside this window, minting and burning is not supported.)

> End users may still buy and sell Stock Tokens on-chain outside the tokenization window.

02:00 in Paris is 20:00 in New York except in the weeks when only one side has changed its clocks. Q7 covers those weeks.

Daily break or maintenance window: none. Chainlink lists "None" under daily breaks for 24/5, its sub-sessions meet at 04:00, 09:30, 16:00 and 20:00, and Robinhood describes one continuous market from Sunday 20:00 to Friday 20:00. The only maintenance Chainlink mentions happens while the market is closed (https://docs.chain.link/data-streams/rwa-streams/24-5-us-equities-user-guide, commit 10264db):

> When the market is closed, data providers may perform maintenance, which can result in stale or incorrect prices being published.

The onchain record agrees. NVDA, QQQ and AAPL have rounds in every one of the 24 New York hours, and the four feeds posted 25, 79, 127 and 41 rounds (SPY, QQQ, NVDA, AAPL) between 20:00 Monday to Thursday and 04:00 the next morning. Robinhood Chain's notices page lists no market-hours maintenance either.

## 3. US Eastern daylight-saving transitions

The rule, from 15 U.S.C. 260a(a) (https://www.law.cornell.edu/uscode/text/15/260a, read 15:04 UTC):

> During the period commencing at 2 o’clock antemeridian on the second Sunday of March of each year and ending at 2 o’clock antemeridian on the first Sunday of November of each year, the standard time of each zone established by sections 261 to 264 of this title, as modified by section 265 of this title, shall be advanced one hour

Computed with Python 3.11.7 zoneinfo for America/New_York. The script scans UTC hour by hour and bisects each offset change to the second (appendix A). It gives the same instants with the bundled tzdata package, version 2026d, and with the macOS system database, version 2026c.

| Switch | UTC integer | UTC ISO | Last second before, local | First second after, local |
| --- | --- | --- | --- | --- |
| 2025 end | 1762063200 | 2025-11-02T06:00:00Z | 01:59:59 EDT, UTC-4 | 01:00:00 EST, UTC-5 |
| 2026 start | 1772953200 | 2026-03-08T07:00:00Z | 01:59:59 EST, UTC-5 | 03:00:00 EDT, UTC-4 |
| 2026 end | 1793512800 | 2026-11-01T06:00:00Z | 01:59:59 EDT, UTC-4 | 01:00:00 EST, UTC-5 |
| 2027 start | 1805007600 | 2027-03-14T07:00:00Z | 01:59:59 EST, UTC-5 | 03:00:00 EDT, UTC-4 |
| 2027 end | 1825567200 | 2027-11-07T06:00:00Z | 01:59:59 EDT, UTC-4 | 01:00:00 EST, UTC-5 |
| 2028 start | 1836457200 | 2028-03-12T07:00:00Z | 01:59:59 EST, UTC-5 | 03:00:00 EDT, UTC-4 |

So for 1762063200 <= t < 1836457200 the offset is UTC-4 when t is in [1772953200, 1793512800) or [1805007600, 1825567200), and UTC-5 otherwise.

Each switch is at 02:00 local on a Sunday. For ALL_DAY that is inside the closure from Friday 20:00 to Sunday 20:00, and for REGULAR it is outside 09:30 to 16:00, so an open session never sees two offsets. The weekends around the switches are one hour shorter or longer in UTC:

| Switch | Friday close before | Sunday open after | Weekend hours |
| --- | --- | --- | --- |
| 2026-03-08T07:00:00Z | Fri 2026-03-06 20:00 EST, 1772845200 (2026-03-07T01:00:00Z) | Sun 2026-03-08 20:00 EDT, 1773014400 (2026-03-09T00:00:00Z) | 47 |
| 2026-11-01T06:00:00Z | Fri 2026-10-30 20:00 EDT, 1793404800 (2026-10-31T00:00:00Z) | Sun 2026-11-01 20:00 EST, 1793581200 (2026-11-02T01:00:00Z) | 49 |
| 2027-03-14T07:00:00Z | Fri 2027-03-12 20:00 EST, 1804899600 (2027-03-13T01:00:00Z) | Sun 2027-03-14 20:00 EDT, 1805068800 (2027-03-15T00:00:00Z) | 47 |
| 2027-11-07T06:00:00Z | Fri 2027-11-05 20:00 EDT, 1825459200 (2027-11-06T00:00:00Z) | Sun 2027-11-07 20:00 EST, 1825635600 (2027-11-08T01:00:00Z) | 49 |

A pending bill would remove the switches. H.R. 139, the Sunshine Protection Act of 2025, passed the House and waits in a Senate committee (https://www.govinfo.gov/content/pkg/BILLS-119hr139rfs/html/BILLS-119hr139rfs.htm, read 15:04 UTC):

```text
Section 3 of the Uniform Time Act of 1966 (15 U.S.C. 260a) is hereby repealed.
(B) by striking ``5 hours'' and inserting ``4 hours'';
Passed the House of Representatives July 14, 2026.
```

The bill status file (https://www.govinfo.gov/bulkdata/BILLSTATUS/119/hr/BILLSTATUS-119hr139.xml, updateDate 2026-09-08T18:03:40Z, read 15:05 UTC) gives the latest action, dated 2026-07-15:

> Received in the Senate and Read twice and referred to the Committee on Commerce, Science, and Transportation.

The bill sets no later effective date. If it becomes law, New York stays at UTC-4 and every "end" row above becomes wrong. Q5 covers this.

## 4. NYSE holidays and early closes

From NYSE's hours and calendars page. https://www.nyse.com/markets/hours-calendars redirects to https://www.nyse.com/trade/hours-calendars, read 14:56 UTC.

> All NYSE markets observe U.S. holidays as listed below for 2026, 2027, and 2028.

```text
Holiday | 2026 | 2027 | 2028
New Year’s Day | Thursday, January 1 | Friday, January 1 | —*
Martin Luther King, Jr. Day | Monday, January 19 | Monday, January 18 | Monday, January 17
Washington's Birthday | Monday, February 16 | Monday, February 15 | Monday, February 21
Good Friday | Friday, April 3 | Friday, March 26 | Friday, April 14
Memorial Day | Monday, May 25 | Monday, May 31 | Monday, May 29
Juneteenth National Independence Day | Friday, June 19 | Friday, June 18 (Juneteenth National Independence Day observed) | Monday, June 19
Independence Day | Friday, July 3 (Independence Day observed) | Monday, July 5 (Independence Day observed) | Tuesday, July 4**
Labor Day | Monday, September 7 | Monday, September 6 | Monday, September 4
Thanksgiving Day | Thursday, November 26*** | Thursday, November 25*** | Thursday, November 23***
Christmas Day | Friday, December 25**** | Friday, December 24 (Christmas Day observed) | Monday, December 25
* Because the holiday falls on Saturday, January 1, 2028, no New Year’s Day holiday is observed.
*** Each market will close early at 1:00 p.m. (1:15 p.m. for eligible options) on Friday, November 27, 2026, Friday, November 26, 2027, and Friday, November 24, 2028 (the day after Thanksgiving). NYSE American Equities, NYSE Arca Equities, NYSE National, and NYSE Texas late trading sessions will close at 5:00 p.m. All times are Eastern Time.
**** Each market will close early at 1:00 p.m. (1:15 p.m. for eligible options) on Thursday, December 24, 2026. NYSE American Equities, NYSE Arca Equities, NYSE National, and NYSE Texas late trading sessions will close at 5:00 p.m. All times are Eastern Time.
```

Full-day closures for the library:

| Holiday | 2026 | 2027 | Note |
| --- | --- | --- | --- |
| New Year's Day | Thu 1 Jan | Fri 1 Jan | 1 Jan 2028 is a Saturday and is not observed, so Fri 31 Dec 2027 is a full trading day |
| Martin Luther King, Jr. Day | Mon 19 Jan | Mon 18 Jan | |
| Washington's Birthday | Mon 16 Feb | Mon 15 Feb | |
| Good Friday | Fri 3 Apr | Fri 26 Mar | |
| Memorial Day | Mon 25 May | Mon 31 May | |
| Juneteenth | Fri 19 Jun | Fri 18 Jun | 2027 observed, 19 Jun is a Saturday |
| Independence Day | Fri 3 Jul | Mon 5 Jul | both observed, 4 Jul falls on Saturday in 2026 and Sunday in 2027 |
| Labor Day | Mon 7 Sep | Mon 6 Sep | |
| Thanksgiving Day | Thu 26 Nov | Thu 25 Nov | |
| Christmas Day | Fri 25 Dec | Fri 24 Dec | 2027 observed, 25 Dec is a Saturday |

Early closes for the library:

| Date | Regular close 13:00 ET | 24/5 close 17:00 ET | Next 24/5 open |
| --- | --- | --- | --- |
| Fri 27 Nov 2026 | 1795802400 (2026-11-27T18:00:00Z) | 1795816800 (2026-11-27T22:00:00Z) | Sun 2026-11-29 20:00 EST, 1796000400 (2026-11-30T01:00:00Z) |
| Thu 24 Dec 2026 | 1798135200 (2026-12-24T18:00:00Z) | 1798149600 (2026-12-24T22:00:00Z) | Sun 2026-12-27 20:00 EST, 1798419600 (2026-12-28T01:00:00Z) |
| Fri 26 Nov 2027 | 1827252000 (2027-11-26T18:00:00Z) | 1827266400 (2027-11-26T22:00:00Z) | Sun 2027-11-28 20:00 EST, 1827450000 (2027-11-29T01:00:00Z) |

There is no early close on Thu 2 Jul 2026, Fri 2 Jul 2027, Thu 23 Dec 2027 or Fri 31 Dec 2027. NYSE lists none, and both Python packages below close those days at 16:00. Chainlink's market-hours page has a row "Jul 3, 2026 | US Independence Day (observed) | 13:00", but that table is for precious metals spot. For equities 3 Jul 2026 is a full holiday.

Cross-checks, all agreeing with the NYSE page:

- exchange_calendars 4.13.2, calendar XNYS, and pandas_market_calendars 5.4.0, calendar NYSE, installed in a scratch virtualenv. Both give the same 20 weekday holidays and the same 3 early closes at 13:00 for 2026 and 2027 (appendix B).
- NYSE's Trading_Days.pdf (https://www.nyse.com/publicdocs/Trading_Days.pdf, read 15:06 UTC) gives US cash equities trading days per month. 2026: 20 19 22 21 20 21 22 21 21 22 20 22, total 251. 2027: 19 19 22 22 20 21 21 22 21 21 21 22, total 251. The calendar above gives the same count in every month.
- Robinhood's closures page lists the same 2026 holidays and the same two 2026 half-days (https://robinhood.com/us/en/support/articles/stock-market-closures/, read 14:59 UTC):

> Stock market trading will close at 1 PM ET (with extended-hours trading concluding at 5 PM ET) on the following upcoming US market half-days:

> Native American Heritage Day, the day after Thanksgiving (November 27)

> Day before Christmas (December 24)

## 5. The 24/5 session around holidays

The overnight session that starts at 20:00 belongs to the next day's trading. When the next day is a holiday, that evening does not open. Robinhood and the overnight venue Blue Ocean ATS both say so, and the feed record agrees.

Robinhood (https://robinhood.com/us/en/support/articles/24hour-market/):

> Orders entered for the 24 Hour Market generally could be executed 12 AM-8 PM ET on a full trading day (meaning Monday-Friday except for stock market holidays and half-days), 12 AM-5 PM ET on a stock market half-day, and 8 PM-12 AM ET on the day before either a full trading day or a stock market half-day.

Blue Ocean ATS, an overnight venue for US stocks, explains the mechanism (https://blueocean-tech.io/faq/, read 15:02 UTC):

> It operates only on those calendar days when the NYSE Trade Report Facility (TRF) is open for reporting the following morning. Trades executed between 8:00 PM ET and 12:00 AM ET will carry a trade date of the following trade day.

It also publishes the evenings it skips (https://blueocean-tech.io/trading-updates/, read 15:02 UTC):

> Blue Ocean ATS will be closed in observance of U.S. holidays as listed below for 2025, 2026, and 2027.

```text
Holiday | 2025 | 2026 | 2027
New Year's Day | Wednesday, December 31 | Thursday, December 31 | Friday, December 31
Martin Luther King, Jr. Day | Sunday, January 19 | Sunday, January 18 | Sunday, January 17
Washington's Birthday | Sunday, February 16 | Sunday, February 15 | Sunday, February 14
Good Friday | Thursday, April 17 | Thursday, April 2 | Thursday, March 25
Memorial Day | Sunday, May 25 | Sunday, May 24 | Sunday, May 30
Juneteenth National Independence Day | Wednesday, June 18 | Thursday, June 18 | Thursday, June 17
Independence Day | Thursday, July 3 | Thursday, July 2 | Sunday, July 4
Labor Day | Sunday, August 31 | Sunday, September 6 | Sunday, September 5
Thanksgiving Day | Wednesday, November 26 | Wednesday, November 25 | Wednesday, November 24
Christmas Day | Wednesday, December 24 | Thursday, December 24 | Thursday, December 23
```

Each date is the evening before the holiday. In the New Year's row each column holds 31 December, the evening before the next year's 1 January.

Chainlink defines the closed status and says nothing about which evening a holiday removes (24/5 guide, commit 10264db, and tokenized equity page, commit 99765ab):

> Market status 5 indicates the market is closed, which includes weekends, public holidays, and unexpected market closures. During these periods, all three feeds will carry stale values.

> These feeds do not publish updates, including heartbeat updates, while markets are closed. The feed's timestamp reflects the final update published before the market closed.

> Incorporate authoritative exchange holiday calendars (NYSE/NASDAQ for US equities) into your integration

The three cases for ALL_DAY:

- Monday holiday, for example Martin Luther King, Jr. Day, Mon 19 Jan 2026. The week before closes Fri 16 Jan 20:00 EST, 1768611600 (2026-01-17T01:00:00Z). Sunday 18 Jan does not open at 20:00. The market reopens Mon 19 Jan 20:00 EST, 1768870800 (2026-01-20T01:00:00Z), 72 hours later. Labor Day 2026 ran exactly this way onchain: nothing on Sunday 6 Sep, and every launch feed posted 31 to 54 seconds after Mon 7 Sep 20:00 EDT, 1788825600 (2026-09-08T00:00:00Z).
- Friday holiday, for example Good Friday, Fri 3 Apr 2026. Thursday's session closes Thu 2 Apr 20:00 EDT, 1775174400 (2026-04-03T00:00:00Z), and the market reopens Sun 5 Apr 20:00 EDT, 1775433600 (2026-04-06T00:00:00Z). Independence Day observed, Fri 3 Jul 2026, ran this way onchain: the last session closed Thu 2 Jul 20:00 EDT and the next opened Sun 5 Jul 20:00 EDT with rounds 18 to 42 seconds later.
- Midweek holiday, for example Thanksgiving, Thu 26 Nov 2026. Wednesday closes Wed 25 Nov 20:00 EST, 1795654800 (2026-11-26T01:00:00Z). The market reopens Thu 26 Nov 20:00 EST, 1795741200 (2026-11-27T01:00:00Z), 24 hours later, for the Friday half-day. New Year's Day 2026 (Thursday) and Thanksgiving 2027 have the same shape.

Every holiday in range:

| Holiday | Date | 24/5 closes | 24/5 reopens | Hours closed |
| --- | --- | --- | --- | --- |
| New Year's Day | Thu 1 Jan 2026 | Wed 2025-12-31 20:00 EST, 1767229200 (2026-01-01T01:00:00Z) | Thu 2026-01-01 20:00 EST, 1767315600 (2026-01-02T01:00:00Z) | 24 |
| Martin Luther King, Jr. Day | Mon 19 Jan 2026 | Fri 2026-01-16 20:00 EST, 1768611600 (2026-01-17T01:00:00Z) | Mon 2026-01-19 20:00 EST, 1768870800 (2026-01-20T01:00:00Z) | 72 |
| Washington's Birthday | Mon 16 Feb 2026 | Fri 2026-02-13 20:00 EST, 1771030800 (2026-02-14T01:00:00Z) | Mon 2026-02-16 20:00 EST, 1771290000 (2026-02-17T01:00:00Z) | 72 |
| Good Friday | Fri 3 Apr 2026 | Thu 2026-04-02 20:00 EDT, 1775174400 (2026-04-03T00:00:00Z) | Sun 2026-04-05 20:00 EDT, 1775433600 (2026-04-06T00:00:00Z) | 72 |
| Memorial Day | Mon 25 May 2026 | Fri 2026-05-22 20:00 EDT, 1779494400 (2026-05-23T00:00:00Z) | Mon 2026-05-25 20:00 EDT, 1779753600 (2026-05-26T00:00:00Z) | 72 |
| Juneteenth | Fri 19 Jun 2026 | Thu 2026-06-18 20:00 EDT, 1781827200 (2026-06-19T00:00:00Z) | Sun 2026-06-21 20:00 EDT, 1782086400 (2026-06-22T00:00:00Z) | 72 |
| Independence Day (observed) | Fri 3 Jul 2026 | Thu 2026-07-02 20:00 EDT, 1783036800 (2026-07-03T00:00:00Z) | Sun 2026-07-05 20:00 EDT, 1783296000 (2026-07-06T00:00:00Z) | 72 |
| Labor Day | Mon 7 Sep 2026 | Fri 2026-09-04 20:00 EDT, 1788566400 (2026-09-05T00:00:00Z) | Mon 2026-09-07 20:00 EDT, 1788825600 (2026-09-08T00:00:00Z) | 72 |
| Thanksgiving Day | Thu 26 Nov 2026 | Wed 2026-11-25 20:00 EST, 1795654800 (2026-11-26T01:00:00Z) | Thu 2026-11-26 20:00 EST, 1795741200 (2026-11-27T01:00:00Z) | 24 |
| Christmas Day | Fri 25 Dec 2026 | Thu 2026-12-24 17:00 EST, 1798149600 (2026-12-24T22:00:00Z) | Sun 2026-12-27 20:00 EST, 1798419600 (2026-12-28T01:00:00Z) | 75 |
| New Year's Day | Fri 1 Jan 2027 | Thu 2026-12-31 20:00 EST, 1798765200 (2027-01-01T01:00:00Z) | Sun 2027-01-03 20:00 EST, 1799024400 (2027-01-04T01:00:00Z) | 72 |
| Martin Luther King, Jr. Day | Mon 18 Jan 2027 | Fri 2027-01-15 20:00 EST, 1800061200 (2027-01-16T01:00:00Z) | Mon 2027-01-18 20:00 EST, 1800320400 (2027-01-19T01:00:00Z) | 72 |
| Washington's Birthday | Mon 15 Feb 2027 | Fri 2027-02-12 20:00 EST, 1802480400 (2027-02-13T01:00:00Z) | Mon 2027-02-15 20:00 EST, 1802739600 (2027-02-16T01:00:00Z) | 72 |
| Good Friday | Fri 26 Mar 2027 | Thu 2027-03-25 20:00 EDT, 1806019200 (2027-03-26T00:00:00Z) | Sun 2027-03-28 20:00 EDT, 1806278400 (2027-03-29T00:00:00Z) | 72 |
| Memorial Day | Mon 31 May 2027 | Fri 2027-05-28 20:00 EDT, 1811548800 (2027-05-29T00:00:00Z) | Mon 2027-05-31 20:00 EDT, 1811808000 (2027-06-01T00:00:00Z) | 72 |
| Juneteenth (observed) | Fri 18 Jun 2027 | Thu 2027-06-17 20:00 EDT, 1813276800 (2027-06-18T00:00:00Z) | Sun 2027-06-20 20:00 EDT, 1813536000 (2027-06-21T00:00:00Z) | 72 |
| Independence Day (observed) | Mon 5 Jul 2027 | Fri 2027-07-02 20:00 EDT, 1814572800 (2027-07-03T00:00:00Z) | Mon 2027-07-05 20:00 EDT, 1814832000 (2027-07-06T00:00:00Z) | 72 |
| Labor Day | Mon 6 Sep 2027 | Fri 2027-09-03 20:00 EDT, 1820016000 (2027-09-04T00:00:00Z) | Mon 2027-09-06 20:00 EDT, 1820275200 (2027-09-07T00:00:00Z) | 72 |
| Thanksgiving Day | Thu 25 Nov 2027 | Wed 2027-11-24 20:00 EST, 1827104400 (2027-11-25T01:00:00Z) | Thu 2027-11-25 20:00 EST, 1827190800 (2027-11-26T01:00:00Z) | 24 |
| Christmas Day (observed) | Fri 24 Dec 2027 | Thu 2027-12-23 20:00 EST, 1829610000 (2027-12-24T01:00:00Z) | Sun 2027-12-26 20:00 EST, 1829869200 (2027-12-27T01:00:00Z) | 72 |

Check against Blue Ocean: Blue Ocean's 2026 and 2027 columns hold 20 evenings. 19 fall Sunday to Thursday, and they are exactly the 19 Sunday to Thursday evenings R2 closes in 2026 and 2027 (appendix C). The 20th is Friday 31 Dec 2027, and Friday evenings never open. The 2025 column's Wednesday 31 Dec 2025 is the evening before 1 Jan 2026, which R2 also closes.

## 6. Early-close days

The ALL_DAY session ends at 17:00 New York time on an early-close day. The regular session ends at 13:00. The overnight session after it runs only if the next calendar day is a trading day, and in 2026 and 2027 it never is.

Sources for 17:00:

- Robinhood: "12 AM-5 PM ET on a stock market half-day" (quoted in section 5) and "with extended-hours trading concluding at 5 PM ET" (quoted in section 4).
- NYSE: "late trading sessions will close at 5:00 p.m." (quoted in section 4).
- Chainlink's current pages say nothing about half-days for US equities. An earlier version of the market-hours page said this, and the sentence was removed on 1 July 2026 in commit dc096a6 (https://github.com/smartcontractkit/documentation/blob/c8a40979e4d98934d015a374b1bae712bfa17ba0/src/content/data-streams/market-hours.mdx, commit c8a4097 of 22 June 2026):

> Half-day trading may apply on the eve of certain U.S. holidays (e.g., Jul 3, Nov 28) — consult the linked exchange calendars for exact cut-off times.

The following overnight session, by R2 and Robinhood's rule:

| Early close | 24/5 closes | Next calendar day | Evening session after the close |
| --- | --- | --- | --- |
| Fri 27 Nov 2026 | 1795816800 (2026-11-27T22:00:00Z) | Saturday | none, next open Sun 29 Nov 20:00 EST, 1796000400 (2026-11-30T01:00:00Z) |
| Thu 24 Dec 2026 | 1798149600 (2026-12-24T22:00:00Z) | Christmas Day, holiday | none, Blue Ocean lists Thursday, December 24 as closed; next open Sun 27 Dec 20:00 EST, 1798419600 (2026-12-28T01:00:00Z) |
| Fri 26 Nov 2027 | 1827266400 (2027-11-26T22:00:00Z) | Saturday | none, next open Sun 28 Nov 20:00 EST, 1827450000 (2027-11-29T01:00:00Z) |

The evening before each early close does run, because a half-day counts: Thu 26 Nov 2026 from 20:00 EST (Thanksgiving evening), Wed 23 Dec 2026 from 20:00 EST, and Thu 25 Nov 2027 from 20:00 EST. Blue Ocean's table does not list those evenings as closed.

No early close has happened since the feeds started on 21 June 2026, so the 17:00 end is not yet seen onchain. Q3 covers this.

## 7. Per-ticker session type from the issuer's assets API

The endpoint, from the Stock Token APIs page (https://docs.robinhood.com/chain/stock-token-apis, read 14:52 UTC):

> Endpoint: GET https://api.robinhood.com/rhj/assets

The call, with no key:

```
curl -sS -D assets_all.headers -o assets_all.raw.json https://api.robinhood.com/rhj/assets
```

Retrieved at 1790953062, 2026-10-02T14:57:42Z. The response carried `date: Fri, 02 Oct 2026 14:57:42 GMT`, status 200, content type application/json, 162,103 bytes, 194 assets, sha256 3e378f9cef46a42503496caa35d130a5590072d1be7801d109de64b998e3e78c. The endpoint has no symbol filter: /rhj/assets/SPY returns 404, and ?symbols=SPY returns 400 with "Could not find field "symbols" in the type "crypto_tokenization.service.v1.GetAssetsRequest"."

Files:

- docs/research/assets-api/all-assets.json is the full response, byte for byte.
- docs/research/assets-api/SPY.json, QQQ.json, NVDA.json and AAPL.json are each ticker's object cut byte for byte out of that response. Each file is an exact substring of all-assets.json.

| Ticker | contractAddress, chainId 4663 | id | status | sha256 of the file |
| --- | --- | --- | --- | --- |
| SPY | 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C | 0x000000000000000000000000000000001c6f27a62789417d8ed359ed3c2d3da1 | ASSET_STATUS_ACTIVE | 1b99ba4c7bac8f2850fd59b172725f6b7fc92efd7e5c94458af283705682d488 |
| QQQ | 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 | 0x000000000000000000000000000000002470b933c52d47ccad017ed9ee80c9ed | ASSET_STATUS_ACTIVE | 471b4e93031565ca1a425836bf11717168518136e85c25478b176295c806bf02 |
| NVDA | 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC | 0x00000000000000000000000000000000915f477416294f5099a5e0e09f327ce5 | ASSET_STATUS_ACTIVE | d6d2d0be48964db02bbca1bec1340cc97e2565355f1f7166d8443204dd0f575e |
| AAPL | 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 | 0x00000000000000000000000000000000c2425be3658540dd8e2424cbf3c5c649 | ASSET_STATUS_ACTIVE | 80d41de5ec171c1c244683c4b7f525d69e08abce0a2d421748abdbf68e2b9bd2 |

The tradingCapabilities field, verbatim. It is byte-identical in all four files:

```json
"tradingCapabilities":{"market":{"whole":"TRADING_STATUS_TRADABLE","fractional":"TRADING_STATUS_TRADABLE"},"extended":{"whole":"TRADING_STATUS_TRADABLE","fractional":"TRADING_STATUS_TRADABLE"},"overnight":{"whole":"TRADING_STATUS_TRADABLE","fractional":"TRADING_STATUS_TRADABLE"}}
```

There is no allDayTradability field in the response, for these four or for any asset. Robinhood's two pages describe different shapes. The Stock Token APIs page documents an all-day flag:

> allDayTradability | string | null | RH all-day / overnight (24/5) trading flag for the underlier.

```text
tradable | Underlier is enabled for all-day / 24-5 trading.
untradable | Not enabled for all-day trading.
position_closing_only | All-day session may only close existing positions.
```

The Stock Tokens page documents the shape the API actually returns (https://docs.robinhood.com/chain/stock-tokens):

> Not all Stock Tokens support trading across all sessions (market hours, extended hours, overnight). To discover the trading capabilities for a specific asset, query the assets API:

```text
"overnight": { "whole": "TRADING_STATUS_TRADABLE", "fractional": "TRADING_STATUS_TRADABLE" }
```

Across all 194 assets in the response, 191 are TRADING_STATUS_TRADABLE in all six slots, and 3 are TRADABLE for whole and TRADING_STATUS_UNTRADABLE for fractional in all three sessions. Every asset is ASSET_STATUS_ACTIVE, every asset has tradingCapabilities, and every asset has overnight.whole equal to TRADING_STATUS_TRADABLE. Fractional status describes the broker's fractional-share trading of the underlying and has no bearing on the reference.

Session types the issuer's data allows:

| Type | Issuer data | Open window | Used today |
| --- | --- | --- | --- |
| ALL_DAY | overnight.whole is TRADING_STATUS_TRADABLE, or allDayTradability is tradable | R2 | all 194 assets, including the four launch tickers |
| EXTENDED | extended.whole TRADABLE, overnight.whole not | trading days 04:00 to 20:00 by Chainlink's sub-sessions, 07:00 to 20:00 by Robinhood's broker, 17:00 end on early closes | none |
| REGULAR | market.whole TRADABLE only | trading days 09:30 to 16:00, 13:00 on early closes | none |
| NONE | market.whole not TRADABLE, or tradingCapabilities missing | never | none |

Chainlink's metadata points the same way: every equity feed on Robinhood Chain is us_equities_24/5 (section 2). Q1 and Q2 cover which field to read and which types to carry.

## 8. Onchain check against the launch feeds

Method: read every round of the four launch feeds through getRoundData, batched with Multicall3 at 0xcA11bde05977b3631167028862bE2a173976CA11, over https://robinhood.drpc.org, at about 15:27 UTC (block 78,337,876 right after the read). Round data is current state, so no archive node is needed. Script and output in appendix C.

| Feed | Rounds | First round | Last round read | Rounds outside R2 |
| --- | --- | --- | --- | --- |
| SPY | 154 | Sun 2026-06-21 20:00:43 EDT | Fri 2026-10-02 08:30:38 EDT | 0 |
| QQQ | 401 | Sun 2026-06-21 20:00:43 EDT | Fri 2026-10-02 08:57:12 EDT | 0 |
| NVDA | 1160 | Sun 2026-06-21 20:00:43 EDT | Fri 2026-10-02 11:17:00 EDT | 0 |
| AAPL | 699 | Sun 2026-06-21 20:00:44 EDT | Fri 2026-10-02 11:10:08 EDT | 0 |

What it shows:

- Not one of the 2,414 rounds falls outside the R2 intervals. That includes the weekends, the Friday 3 July holiday and the Monday 7 September holiday.
- At every one of the 15 session opens in the record, all four feeds posted a round 18 to 69 seconds after the open. This makes the absence of a round meaningful. Had Sunday 6 September 20:00 been open, the pattern says rounds would have appeared within about a minute. None did, and they appeared within a minute of Monday 7 September 20:00 instead.
- The first rounds ever, at 1782086443 (2026-06-22T00:00:43Z), came 43 seconds after the Sunday 21 June open that followed the Juneteenth closure.
- Rounds post on weeknights between 20:00 and 04:00, so there is no daily break.

What it cannot show yet: an early close (first one is Friday 27 November 2026), a daylight-saving switch (first one is Sunday 1 November 2026), and a midweek holiday (first one is Thursday 26 November 2026). Rerunning appendix C after each date checks R2 against them.

## 9. Open questions

Each item has a recommended default and the reason for it. None is settled silently in the rules above.

Q1. Which issuer field feeds the session type. PRD section 7.4 takes the per-ticker session type from the issuer's allDayTradability field, but the live API has no such field. It returns tradingCapabilities.overnight.whole instead, as the Stock Tokens page documents. Default: read tradingCapabilities.overnight.whole and treat TRADING_STATUS_TRADABLE as ALL_DAY. Reason: the documented meaning of allDayTradability, "RH all-day / overnight (24/5) trading flag", is the overnight slot of the live shape, and the live API is what the keeper and any reviewer will actually see. The owner should confirm because it changes a PRD field name.

Q2. Which session types the library carries. Default: ALL_DAY plus NONE as the unset value, and REGULAR only if a later ticker needs it. Do not add EXTENDED. Reason: every asset and every Chainlink equity feed on the chain is 24/5 today, and the extended window has no settled start time (Chainlink uses 04:00, Robinhood's broker 07:00). If a ticker ever loses overnight tradability, REGULAR is the safe mapping: it only opens when the multi-sourced regular-hours data is live. A ticker with no type must read as closed and never default to open. One case needs no new type: a token whose only Chainlink feed is a DEX-state price, like GLD / USD in section 2. Chainlink's metadata does not say which pools feed it, so it may move with the same pools Sleeve would buy from, and a premium check against it would not anchor the price to the underlying market. Recommended: such a ticker gets NONE and is not offered as a rule target, which the TokenSource component should enforce. None of the four launch tickers is affected.

Q3. The ALL_DAY end on an early-close day. Default: 17:00 New York time. Reason: Robinhood's 24 Hour Market runs "12 AM-5 PM ET on a stock market half-day", NYSE's late sessions "will close at 5:00 p.m.", and Chainlink's feeds draw on post-market data. Chainlink does not document half-days, and none has happened since launch. The cost of being wrong is small either way. If the library says 17:00 and the reference actually stops at 13:00, buys between 13:00 and 17:00 price against a reference up to four hours old, still bounded by the premium cap. If the library says 13:00 and the reference runs to 17:00, equity shares wait four extra hours before a closure that lasts at least two days anyway. Check the feed rounds on 27 November 2026 between 13:00 and 20:00 New York time, and change the rule before 24 December 2026 if they disagree.

Q4. Boundary convention and the first minute after an open. Default: half-open intervals, open at the opening second and closed at the closing second. Add one more check outside the calendar: the library exposes the opening instant of the current session, and PriceGuard requires the feed's updatedAt to be at or after it. Reason: at a reopen the feed still holds the last pre-close round until the first new round lands 18 to 69 seconds later. After weekends and Monday or Friday holidays the gap is 47 hours or more, and the 25-hour age limit already refuses the stale round. After the three 24-hour midweek closures (1 Jan 2026, 26 Nov 2026, 25 Nov 2027) it does not, whenever the last pre-close round came less than an hour before the close. That happens: QQQ's last round before the 17 July 2026 close came 897 seconds before it. The extra check costs at most about a minute of queueing per open. This touches PriceGuard and the PRD's check order, so the owner should decide.

Q5. A change to daylight-saving law. Default: encode current law, as in section 3, and make the timelocked extension path able to replace switch entries that are still in the future, not only append new ones. Reason: H.R. 139 passed the House on 14 July 2026, has no delayed effective date, and would keep New York at UTC-4. If it became law with less notice than the 48-hour timelock, every session boundary would be one hour off in UTC until the update lands.

Q6. Unscheduled closures. Default: the timelocked path can add a full-day closure or an early close, and nothing else changes. Reason: the NYSE does close at short notice. exchange_calendars lists two national days of mourning, 5 Dec 2018 and 9 Jan 2025, as ad hoc XNYS closures. Chainlink also says its feeds do not flag "Exchange public holidays", "Trading halts (regulatory, news-pending, circuit breakers)" or "Other operational closures". A closure announced less than 48 hours ahead, a halt, or a corporate-action pause is guarded only by PriceGuard's age, oraclePaused and premium checks. That is the PRD's design already, and it is worth stating in DECISIONS.md.

Q7. The issuer's mint and burn window in Paris time. Default: ignore it and follow New York time only. Reason: the window "Monday 02:00 CET/CEST – Saturday 02:00 CET/CEST" governs market makers minting and burning, and the Stock Tokens page itself says end users trade outside it. The reference follows ET, as Chainlink states and the record shows. In the weeks when only one side has switched clocks, the mint window opens at 21:00 New York time on Sunday and closes at 21:00 on Friday. In range those are the weeks that start Sunday 8, 15 and 22 Mar 2026 (before the feeds launched), 25 Oct 2026, 14 and 21 Mar 2027, and 31 Oct 2027 (Paris switches on 29 Mar 2026, 25 Oct 2026, 28 Mar 2027 and 31 Oct 2027). Pool depth may be thinner in the first hour of those weeks, and the premium cap covers that.

Q8. Queries outside 2026 and 2027. Default: revert with a named custom error for any timestamp before 1767243600 or at or after 1830315600, and expose the coverage end so the module can turn it into a QUEUED reason instead of a revert. Reason: the build contract forbids silent fallback, and answering "closed" with no data would hide an expired calendar. The weekend logic alone could answer until Sunday 2 Jan 2028 20:00 EST, but relying on that buys two days and adds a special case. The 2028 holidays are already published on the NYSE page above, so the extension can be queued long before December 2027.

Q9. Owner's statement versus Robinhood's chain docs. Not a conflict, but worth recording: the Sunday 20:00 to Friday 20:00 window comes from Chainlink and Robinhood's broker pages, not from docs.robinhood.com/chain, which only says "Stock feeds update 24/5, following market hours." Default: cite Chainlink's market-hours page and the feed metadata as the authority in DECISIONS.md.

## 10. All ALL_DAY open intervals, 2026 and 2027

Each row is a half-open interval [opens, closes). Generated by appendix D. 502 trading days in 107 intervals, 12,039 open hours.

| # | Opens, New York | Opens, UTC | Closes, New York | Closes, UTC | Trading days |
| --- | --- | --- | --- | --- | --- |
| 1 | Thu 2026-01-01 20:00 EST | 1767315600 2026-01-02T01:00:00Z | Fri 2026-01-02 20:00 EST | 1767402000 2026-01-03T01:00:00Z | 2 Jan 2026, 1 |
| 2 | Sun 2026-01-04 20:00 EST | 1767574800 2026-01-05T01:00:00Z | Fri 2026-01-09 20:00 EST | 1768006800 2026-01-10T01:00:00Z | 5 Jan to 9 Jan 2026, 5 |
| 3 | Sun 2026-01-11 20:00 EST | 1768179600 2026-01-12T01:00:00Z | Fri 2026-01-16 20:00 EST | 1768611600 2026-01-17T01:00:00Z | 12 Jan to 16 Jan 2026, 5 |
| 4 | Mon 2026-01-19 20:00 EST | 1768870800 2026-01-20T01:00:00Z | Fri 2026-01-23 20:00 EST | 1769216400 2026-01-24T01:00:00Z | 20 Jan to 23 Jan 2026, 4 |
| 5 | Sun 2026-01-25 20:00 EST | 1769389200 2026-01-26T01:00:00Z | Fri 2026-01-30 20:00 EST | 1769821200 2026-01-31T01:00:00Z | 26 Jan to 30 Jan 2026, 5 |
| 6 | Sun 2026-02-01 20:00 EST | 1769994000 2026-02-02T01:00:00Z | Fri 2026-02-06 20:00 EST | 1770426000 2026-02-07T01:00:00Z | 2 Feb to 6 Feb 2026, 5 |
| 7 | Sun 2026-02-08 20:00 EST | 1770598800 2026-02-09T01:00:00Z | Fri 2026-02-13 20:00 EST | 1771030800 2026-02-14T01:00:00Z | 9 Feb to 13 Feb 2026, 5 |
| 8 | Mon 2026-02-16 20:00 EST | 1771290000 2026-02-17T01:00:00Z | Fri 2026-02-20 20:00 EST | 1771635600 2026-02-21T01:00:00Z | 17 Feb to 20 Feb 2026, 4 |
| 9 | Sun 2026-02-22 20:00 EST | 1771808400 2026-02-23T01:00:00Z | Fri 2026-02-27 20:00 EST | 1772240400 2026-02-28T01:00:00Z | 23 Feb to 27 Feb 2026, 5 |
| 10 | Sun 2026-03-01 20:00 EST | 1772413200 2026-03-02T01:00:00Z | Fri 2026-03-06 20:00 EST | 1772845200 2026-03-07T01:00:00Z | 2 Mar to 6 Mar 2026, 5 |
| 11 | Sun 2026-03-08 20:00 EDT | 1773014400 2026-03-09T00:00:00Z | Fri 2026-03-13 20:00 EDT | 1773446400 2026-03-14T00:00:00Z | 9 Mar to 13 Mar 2026, 5 |
| 12 | Sun 2026-03-15 20:00 EDT | 1773619200 2026-03-16T00:00:00Z | Fri 2026-03-20 20:00 EDT | 1774051200 2026-03-21T00:00:00Z | 16 Mar to 20 Mar 2026, 5 |
| 13 | Sun 2026-03-22 20:00 EDT | 1774224000 2026-03-23T00:00:00Z | Fri 2026-03-27 20:00 EDT | 1774656000 2026-03-28T00:00:00Z | 23 Mar to 27 Mar 2026, 5 |
| 14 | Sun 2026-03-29 20:00 EDT | 1774828800 2026-03-30T00:00:00Z | Thu 2026-04-02 20:00 EDT | 1775174400 2026-04-03T00:00:00Z | 30 Mar to 2 Apr 2026, 4 |
| 15 | Sun 2026-04-05 20:00 EDT | 1775433600 2026-04-06T00:00:00Z | Fri 2026-04-10 20:00 EDT | 1775865600 2026-04-11T00:00:00Z | 6 Apr to 10 Apr 2026, 5 |
| 16 | Sun 2026-04-12 20:00 EDT | 1776038400 2026-04-13T00:00:00Z | Fri 2026-04-17 20:00 EDT | 1776470400 2026-04-18T00:00:00Z | 13 Apr to 17 Apr 2026, 5 |
| 17 | Sun 2026-04-19 20:00 EDT | 1776643200 2026-04-20T00:00:00Z | Fri 2026-04-24 20:00 EDT | 1777075200 2026-04-25T00:00:00Z | 20 Apr to 24 Apr 2026, 5 |
| 18 | Sun 2026-04-26 20:00 EDT | 1777248000 2026-04-27T00:00:00Z | Fri 2026-05-01 20:00 EDT | 1777680000 2026-05-02T00:00:00Z | 27 Apr to 1 May 2026, 5 |
| 19 | Sun 2026-05-03 20:00 EDT | 1777852800 2026-05-04T00:00:00Z | Fri 2026-05-08 20:00 EDT | 1778284800 2026-05-09T00:00:00Z | 4 May to 8 May 2026, 5 |
| 20 | Sun 2026-05-10 20:00 EDT | 1778457600 2026-05-11T00:00:00Z | Fri 2026-05-15 20:00 EDT | 1778889600 2026-05-16T00:00:00Z | 11 May to 15 May 2026, 5 |
| 21 | Sun 2026-05-17 20:00 EDT | 1779062400 2026-05-18T00:00:00Z | Fri 2026-05-22 20:00 EDT | 1779494400 2026-05-23T00:00:00Z | 18 May to 22 May 2026, 5 |
| 22 | Mon 2026-05-25 20:00 EDT | 1779753600 2026-05-26T00:00:00Z | Fri 2026-05-29 20:00 EDT | 1780099200 2026-05-30T00:00:00Z | 26 May to 29 May 2026, 4 |
| 23 | Sun 2026-05-31 20:00 EDT | 1780272000 2026-06-01T00:00:00Z | Fri 2026-06-05 20:00 EDT | 1780704000 2026-06-06T00:00:00Z | 1 Jun to 5 Jun 2026, 5 |
| 24 | Sun 2026-06-07 20:00 EDT | 1780876800 2026-06-08T00:00:00Z | Fri 2026-06-12 20:00 EDT | 1781308800 2026-06-13T00:00:00Z | 8 Jun to 12 Jun 2026, 5 |
| 25 | Sun 2026-06-14 20:00 EDT | 1781481600 2026-06-15T00:00:00Z | Thu 2026-06-18 20:00 EDT | 1781827200 2026-06-19T00:00:00Z | 15 Jun to 18 Jun 2026, 4 |
| 26 | Sun 2026-06-21 20:00 EDT | 1782086400 2026-06-22T00:00:00Z | Fri 2026-06-26 20:00 EDT | 1782518400 2026-06-27T00:00:00Z | 22 Jun to 26 Jun 2026, 5 |
| 27 | Sun 2026-06-28 20:00 EDT | 1782691200 2026-06-29T00:00:00Z | Thu 2026-07-02 20:00 EDT | 1783036800 2026-07-03T00:00:00Z | 29 Jun to 2 Jul 2026, 4 |
| 28 | Sun 2026-07-05 20:00 EDT | 1783296000 2026-07-06T00:00:00Z | Fri 2026-07-10 20:00 EDT | 1783728000 2026-07-11T00:00:00Z | 6 Jul to 10 Jul 2026, 5 |
| 29 | Sun 2026-07-12 20:00 EDT | 1783900800 2026-07-13T00:00:00Z | Fri 2026-07-17 20:00 EDT | 1784332800 2026-07-18T00:00:00Z | 13 Jul to 17 Jul 2026, 5 |
| 30 | Sun 2026-07-19 20:00 EDT | 1784505600 2026-07-20T00:00:00Z | Fri 2026-07-24 20:00 EDT | 1784937600 2026-07-25T00:00:00Z | 20 Jul to 24 Jul 2026, 5 |
| 31 | Sun 2026-07-26 20:00 EDT | 1785110400 2026-07-27T00:00:00Z | Fri 2026-07-31 20:00 EDT | 1785542400 2026-08-01T00:00:00Z | 27 Jul to 31 Jul 2026, 5 |
| 32 | Sun 2026-08-02 20:00 EDT | 1785715200 2026-08-03T00:00:00Z | Fri 2026-08-07 20:00 EDT | 1786147200 2026-08-08T00:00:00Z | 3 Aug to 7 Aug 2026, 5 |
| 33 | Sun 2026-08-09 20:00 EDT | 1786320000 2026-08-10T00:00:00Z | Fri 2026-08-14 20:00 EDT | 1786752000 2026-08-15T00:00:00Z | 10 Aug to 14 Aug 2026, 5 |
| 34 | Sun 2026-08-16 20:00 EDT | 1786924800 2026-08-17T00:00:00Z | Fri 2026-08-21 20:00 EDT | 1787356800 2026-08-22T00:00:00Z | 17 Aug to 21 Aug 2026, 5 |
| 35 | Sun 2026-08-23 20:00 EDT | 1787529600 2026-08-24T00:00:00Z | Fri 2026-08-28 20:00 EDT | 1787961600 2026-08-29T00:00:00Z | 24 Aug to 28 Aug 2026, 5 |
| 36 | Sun 2026-08-30 20:00 EDT | 1788134400 2026-08-31T00:00:00Z | Fri 2026-09-04 20:00 EDT | 1788566400 2026-09-05T00:00:00Z | 31 Aug to 4 Sep 2026, 5 |
| 37 | Mon 2026-09-07 20:00 EDT | 1788825600 2026-09-08T00:00:00Z | Fri 2026-09-11 20:00 EDT | 1789171200 2026-09-12T00:00:00Z | 8 Sep to 11 Sep 2026, 4 |
| 38 | Sun 2026-09-13 20:00 EDT | 1789344000 2026-09-14T00:00:00Z | Fri 2026-09-18 20:00 EDT | 1789776000 2026-09-19T00:00:00Z | 14 Sep to 18 Sep 2026, 5 |
| 39 | Sun 2026-09-20 20:00 EDT | 1789948800 2026-09-21T00:00:00Z | Fri 2026-09-25 20:00 EDT | 1790380800 2026-09-26T00:00:00Z | 21 Sep to 25 Sep 2026, 5 |
| 40 | Sun 2026-09-27 20:00 EDT | 1790553600 2026-09-28T00:00:00Z | Fri 2026-10-02 20:00 EDT | 1790985600 2026-10-03T00:00:00Z | 28 Sep to 2 Oct 2026, 5 |
| 41 | Sun 2026-10-04 20:00 EDT | 1791158400 2026-10-05T00:00:00Z | Fri 2026-10-09 20:00 EDT | 1791590400 2026-10-10T00:00:00Z | 5 Oct to 9 Oct 2026, 5 |
| 42 | Sun 2026-10-11 20:00 EDT | 1791763200 2026-10-12T00:00:00Z | Fri 2026-10-16 20:00 EDT | 1792195200 2026-10-17T00:00:00Z | 12 Oct to 16 Oct 2026, 5 |
| 43 | Sun 2026-10-18 20:00 EDT | 1792368000 2026-10-19T00:00:00Z | Fri 2026-10-23 20:00 EDT | 1792800000 2026-10-24T00:00:00Z | 19 Oct to 23 Oct 2026, 5 |
| 44 | Sun 2026-10-25 20:00 EDT | 1792972800 2026-10-26T00:00:00Z | Fri 2026-10-30 20:00 EDT | 1793404800 2026-10-31T00:00:00Z | 26 Oct to 30 Oct 2026, 5 |
| 45 | Sun 2026-11-01 20:00 EST | 1793581200 2026-11-02T01:00:00Z | Fri 2026-11-06 20:00 EST | 1794013200 2026-11-07T01:00:00Z | 2 Nov to 6 Nov 2026, 5 |
| 46 | Sun 2026-11-08 20:00 EST | 1794186000 2026-11-09T01:00:00Z | Fri 2026-11-13 20:00 EST | 1794618000 2026-11-14T01:00:00Z | 9 Nov to 13 Nov 2026, 5 |
| 47 | Sun 2026-11-15 20:00 EST | 1794790800 2026-11-16T01:00:00Z | Fri 2026-11-20 20:00 EST | 1795222800 2026-11-21T01:00:00Z | 16 Nov to 20 Nov 2026, 5 |
| 48 | Sun 2026-11-22 20:00 EST | 1795395600 2026-11-23T01:00:00Z | Wed 2026-11-25 20:00 EST | 1795654800 2026-11-26T01:00:00Z | 23 Nov to 25 Nov 2026, 3 |
| 49 | Thu 2026-11-26 20:00 EST | 1795741200 2026-11-27T01:00:00Z | Fri 2026-11-27 17:00 EST | 1795816800 2026-11-27T22:00:00Z | 27 Nov 2026, 1 |
| 50 | Sun 2026-11-29 20:00 EST | 1796000400 2026-11-30T01:00:00Z | Fri 2026-12-04 20:00 EST | 1796432400 2026-12-05T01:00:00Z | 30 Nov to 4 Dec 2026, 5 |
| 51 | Sun 2026-12-06 20:00 EST | 1796605200 2026-12-07T01:00:00Z | Fri 2026-12-11 20:00 EST | 1797037200 2026-12-12T01:00:00Z | 7 Dec to 11 Dec 2026, 5 |
| 52 | Sun 2026-12-13 20:00 EST | 1797210000 2026-12-14T01:00:00Z | Fri 2026-12-18 20:00 EST | 1797642000 2026-12-19T01:00:00Z | 14 Dec to 18 Dec 2026, 5 |
| 53 | Sun 2026-12-20 20:00 EST | 1797814800 2026-12-21T01:00:00Z | Thu 2026-12-24 17:00 EST | 1798149600 2026-12-24T22:00:00Z | 21 Dec to 24 Dec 2026, 4 |
| 54 | Sun 2026-12-27 20:00 EST | 1798419600 2026-12-28T01:00:00Z | Thu 2026-12-31 20:00 EST | 1798765200 2027-01-01T01:00:00Z | 28 Dec to 31 Dec 2026, 4 |
| 55 | Sun 2027-01-03 20:00 EST | 1799024400 2027-01-04T01:00:00Z | Fri 2027-01-08 20:00 EST | 1799456400 2027-01-09T01:00:00Z | 4 Jan to 8 Jan 2027, 5 |
| 56 | Sun 2027-01-10 20:00 EST | 1799629200 2027-01-11T01:00:00Z | Fri 2027-01-15 20:00 EST | 1800061200 2027-01-16T01:00:00Z | 11 Jan to 15 Jan 2027, 5 |
| 57 | Mon 2027-01-18 20:00 EST | 1800320400 2027-01-19T01:00:00Z | Fri 2027-01-22 20:00 EST | 1800666000 2027-01-23T01:00:00Z | 19 Jan to 22 Jan 2027, 4 |
| 58 | Sun 2027-01-24 20:00 EST | 1800838800 2027-01-25T01:00:00Z | Fri 2027-01-29 20:00 EST | 1801270800 2027-01-30T01:00:00Z | 25 Jan to 29 Jan 2027, 5 |
| 59 | Sun 2027-01-31 20:00 EST | 1801443600 2027-02-01T01:00:00Z | Fri 2027-02-05 20:00 EST | 1801875600 2027-02-06T01:00:00Z | 1 Feb to 5 Feb 2027, 5 |
| 60 | Sun 2027-02-07 20:00 EST | 1802048400 2027-02-08T01:00:00Z | Fri 2027-02-12 20:00 EST | 1802480400 2027-02-13T01:00:00Z | 8 Feb to 12 Feb 2027, 5 |
| 61 | Mon 2027-02-15 20:00 EST | 1802739600 2027-02-16T01:00:00Z | Fri 2027-02-19 20:00 EST | 1803085200 2027-02-20T01:00:00Z | 16 Feb to 19 Feb 2027, 4 |
| 62 | Sun 2027-02-21 20:00 EST | 1803258000 2027-02-22T01:00:00Z | Fri 2027-02-26 20:00 EST | 1803690000 2027-02-27T01:00:00Z | 22 Feb to 26 Feb 2027, 5 |
| 63 | Sun 2027-02-28 20:00 EST | 1803862800 2027-03-01T01:00:00Z | Fri 2027-03-05 20:00 EST | 1804294800 2027-03-06T01:00:00Z | 1 Mar to 5 Mar 2027, 5 |
| 64 | Sun 2027-03-07 20:00 EST | 1804467600 2027-03-08T01:00:00Z | Fri 2027-03-12 20:00 EST | 1804899600 2027-03-13T01:00:00Z | 8 Mar to 12 Mar 2027, 5 |
| 65 | Sun 2027-03-14 20:00 EDT | 1805068800 2027-03-15T00:00:00Z | Fri 2027-03-19 20:00 EDT | 1805500800 2027-03-20T00:00:00Z | 15 Mar to 19 Mar 2027, 5 |
| 66 | Sun 2027-03-21 20:00 EDT | 1805673600 2027-03-22T00:00:00Z | Thu 2027-03-25 20:00 EDT | 1806019200 2027-03-26T00:00:00Z | 22 Mar to 25 Mar 2027, 4 |
| 67 | Sun 2027-03-28 20:00 EDT | 1806278400 2027-03-29T00:00:00Z | Fri 2027-04-02 20:00 EDT | 1806710400 2027-04-03T00:00:00Z | 29 Mar to 2 Apr 2027, 5 |
| 68 | Sun 2027-04-04 20:00 EDT | 1806883200 2027-04-05T00:00:00Z | Fri 2027-04-09 20:00 EDT | 1807315200 2027-04-10T00:00:00Z | 5 Apr to 9 Apr 2027, 5 |
| 69 | Sun 2027-04-11 20:00 EDT | 1807488000 2027-04-12T00:00:00Z | Fri 2027-04-16 20:00 EDT | 1807920000 2027-04-17T00:00:00Z | 12 Apr to 16 Apr 2027, 5 |
| 70 | Sun 2027-04-18 20:00 EDT | 1808092800 2027-04-19T00:00:00Z | Fri 2027-04-23 20:00 EDT | 1808524800 2027-04-24T00:00:00Z | 19 Apr to 23 Apr 2027, 5 |
| 71 | Sun 2027-04-25 20:00 EDT | 1808697600 2027-04-26T00:00:00Z | Fri 2027-04-30 20:00 EDT | 1809129600 2027-05-01T00:00:00Z | 26 Apr to 30 Apr 2027, 5 |
| 72 | Sun 2027-05-02 20:00 EDT | 1809302400 2027-05-03T00:00:00Z | Fri 2027-05-07 20:00 EDT | 1809734400 2027-05-08T00:00:00Z | 3 May to 7 May 2027, 5 |
| 73 | Sun 2027-05-09 20:00 EDT | 1809907200 2027-05-10T00:00:00Z | Fri 2027-05-14 20:00 EDT | 1810339200 2027-05-15T00:00:00Z | 10 May to 14 May 2027, 5 |
| 74 | Sun 2027-05-16 20:00 EDT | 1810512000 2027-05-17T00:00:00Z | Fri 2027-05-21 20:00 EDT | 1810944000 2027-05-22T00:00:00Z | 17 May to 21 May 2027, 5 |
| 75 | Sun 2027-05-23 20:00 EDT | 1811116800 2027-05-24T00:00:00Z | Fri 2027-05-28 20:00 EDT | 1811548800 2027-05-29T00:00:00Z | 24 May to 28 May 2027, 5 |
| 76 | Mon 2027-05-31 20:00 EDT | 1811808000 2027-06-01T00:00:00Z | Fri 2027-06-04 20:00 EDT | 1812153600 2027-06-05T00:00:00Z | 1 Jun to 4 Jun 2027, 4 |
| 77 | Sun 2027-06-06 20:00 EDT | 1812326400 2027-06-07T00:00:00Z | Fri 2027-06-11 20:00 EDT | 1812758400 2027-06-12T00:00:00Z | 7 Jun to 11 Jun 2027, 5 |
| 78 | Sun 2027-06-13 20:00 EDT | 1812931200 2027-06-14T00:00:00Z | Thu 2027-06-17 20:00 EDT | 1813276800 2027-06-18T00:00:00Z | 14 Jun to 17 Jun 2027, 4 |
| 79 | Sun 2027-06-20 20:00 EDT | 1813536000 2027-06-21T00:00:00Z | Fri 2027-06-25 20:00 EDT | 1813968000 2027-06-26T00:00:00Z | 21 Jun to 25 Jun 2027, 5 |
| 80 | Sun 2027-06-27 20:00 EDT | 1814140800 2027-06-28T00:00:00Z | Fri 2027-07-02 20:00 EDT | 1814572800 2027-07-03T00:00:00Z | 28 Jun to 2 Jul 2027, 5 |
| 81 | Mon 2027-07-05 20:00 EDT | 1814832000 2027-07-06T00:00:00Z | Fri 2027-07-09 20:00 EDT | 1815177600 2027-07-10T00:00:00Z | 6 Jul to 9 Jul 2027, 4 |
| 82 | Sun 2027-07-11 20:00 EDT | 1815350400 2027-07-12T00:00:00Z | Fri 2027-07-16 20:00 EDT | 1815782400 2027-07-17T00:00:00Z | 12 Jul to 16 Jul 2027, 5 |
| 83 | Sun 2027-07-18 20:00 EDT | 1815955200 2027-07-19T00:00:00Z | Fri 2027-07-23 20:00 EDT | 1816387200 2027-07-24T00:00:00Z | 19 Jul to 23 Jul 2027, 5 |
| 84 | Sun 2027-07-25 20:00 EDT | 1816560000 2027-07-26T00:00:00Z | Fri 2027-07-30 20:00 EDT | 1816992000 2027-07-31T00:00:00Z | 26 Jul to 30 Jul 2027, 5 |
| 85 | Sun 2027-08-01 20:00 EDT | 1817164800 2027-08-02T00:00:00Z | Fri 2027-08-06 20:00 EDT | 1817596800 2027-08-07T00:00:00Z | 2 Aug to 6 Aug 2027, 5 |
| 86 | Sun 2027-08-08 20:00 EDT | 1817769600 2027-08-09T00:00:00Z | Fri 2027-08-13 20:00 EDT | 1818201600 2027-08-14T00:00:00Z | 9 Aug to 13 Aug 2027, 5 |
| 87 | Sun 2027-08-15 20:00 EDT | 1818374400 2027-08-16T00:00:00Z | Fri 2027-08-20 20:00 EDT | 1818806400 2027-08-21T00:00:00Z | 16 Aug to 20 Aug 2027, 5 |
| 88 | Sun 2027-08-22 20:00 EDT | 1818979200 2027-08-23T00:00:00Z | Fri 2027-08-27 20:00 EDT | 1819411200 2027-08-28T00:00:00Z | 23 Aug to 27 Aug 2027, 5 |
| 89 | Sun 2027-08-29 20:00 EDT | 1819584000 2027-08-30T00:00:00Z | Fri 2027-09-03 20:00 EDT | 1820016000 2027-09-04T00:00:00Z | 30 Aug to 3 Sep 2027, 5 |
| 90 | Mon 2027-09-06 20:00 EDT | 1820275200 2027-09-07T00:00:00Z | Fri 2027-09-10 20:00 EDT | 1820620800 2027-09-11T00:00:00Z | 7 Sep to 10 Sep 2027, 4 |
| 91 | Sun 2027-09-12 20:00 EDT | 1820793600 2027-09-13T00:00:00Z | Fri 2027-09-17 20:00 EDT | 1821225600 2027-09-18T00:00:00Z | 13 Sep to 17 Sep 2027, 5 |
| 92 | Sun 2027-09-19 20:00 EDT | 1821398400 2027-09-20T00:00:00Z | Fri 2027-09-24 20:00 EDT | 1821830400 2027-09-25T00:00:00Z | 20 Sep to 24 Sep 2027, 5 |
| 93 | Sun 2027-09-26 20:00 EDT | 1822003200 2027-09-27T00:00:00Z | Fri 2027-10-01 20:00 EDT | 1822435200 2027-10-02T00:00:00Z | 27 Sep to 1 Oct 2027, 5 |
| 94 | Sun 2027-10-03 20:00 EDT | 1822608000 2027-10-04T00:00:00Z | Fri 2027-10-08 20:00 EDT | 1823040000 2027-10-09T00:00:00Z | 4 Oct to 8 Oct 2027, 5 |
| 95 | Sun 2027-10-10 20:00 EDT | 1823212800 2027-10-11T00:00:00Z | Fri 2027-10-15 20:00 EDT | 1823644800 2027-10-16T00:00:00Z | 11 Oct to 15 Oct 2027, 5 |
| 96 | Sun 2027-10-17 20:00 EDT | 1823817600 2027-10-18T00:00:00Z | Fri 2027-10-22 20:00 EDT | 1824249600 2027-10-23T00:00:00Z | 18 Oct to 22 Oct 2027, 5 |
| 97 | Sun 2027-10-24 20:00 EDT | 1824422400 2027-10-25T00:00:00Z | Fri 2027-10-29 20:00 EDT | 1824854400 2027-10-30T00:00:00Z | 25 Oct to 29 Oct 2027, 5 |
| 98 | Sun 2027-10-31 20:00 EDT | 1825027200 2027-11-01T00:00:00Z | Fri 2027-11-05 20:00 EDT | 1825459200 2027-11-06T00:00:00Z | 1 Nov to 5 Nov 2027, 5 |
| 99 | Sun 2027-11-07 20:00 EST | 1825635600 2027-11-08T01:00:00Z | Fri 2027-11-12 20:00 EST | 1826067600 2027-11-13T01:00:00Z | 8 Nov to 12 Nov 2027, 5 |
| 100 | Sun 2027-11-14 20:00 EST | 1826240400 2027-11-15T01:00:00Z | Fri 2027-11-19 20:00 EST | 1826672400 2027-11-20T01:00:00Z | 15 Nov to 19 Nov 2027, 5 |
| 101 | Sun 2027-11-21 20:00 EST | 1826845200 2027-11-22T01:00:00Z | Wed 2027-11-24 20:00 EST | 1827104400 2027-11-25T01:00:00Z | 22 Nov to 24 Nov 2027, 3 |
| 102 | Thu 2027-11-25 20:00 EST | 1827190800 2027-11-26T01:00:00Z | Fri 2027-11-26 17:00 EST | 1827266400 2027-11-26T22:00:00Z | 26 Nov 2027, 1 |
| 103 | Sun 2027-11-28 20:00 EST | 1827450000 2027-11-29T01:00:00Z | Fri 2027-12-03 20:00 EST | 1827882000 2027-12-04T01:00:00Z | 29 Nov to 3 Dec 2027, 5 |
| 104 | Sun 2027-12-05 20:00 EST | 1828054800 2027-12-06T01:00:00Z | Fri 2027-12-10 20:00 EST | 1828486800 2027-12-11T01:00:00Z | 6 Dec to 10 Dec 2027, 5 |
| 105 | Sun 2027-12-12 20:00 EST | 1828659600 2027-12-13T01:00:00Z | Fri 2027-12-17 20:00 EST | 1829091600 2027-12-18T01:00:00Z | 13 Dec to 17 Dec 2027, 5 |
| 106 | Sun 2027-12-19 20:00 EST | 1829264400 2027-12-20T01:00:00Z | Thu 2027-12-23 20:00 EST | 1829610000 2027-12-24T01:00:00Z | 20 Dec to 23 Dec 2027, 4 |
| 107 | Sun 2027-12-26 20:00 EST | 1829869200 2027-12-27T01:00:00Z | Fri 2027-12-31 20:00 EST | 1830301200 2028-01-01T01:00:00Z | 27 Dec to 31 Dec 2027, 5 |

## 11. Side findings for other components

- PriceGuard and the constants table. Chainlink's own metadata lists the build contract's SPY, QQQ, NVDA, AAPL and USDG/USD feed proxies with heartbeat 86400 and threshold 0.5 (section 2). Onchain, description() returns "RHSPY / USD", "Robinhood QQQ / USD", "RHNVDA / USD" and "Robinhood AAPL / USD". The issuer API lists the build contract's four token addresses. Those rows marked verify now have an official source for the address, and still need the deploy-time onchain checks.
- TokenSource. Not every Robinhood token with a Chainlink feed has a 24/5 equity reference. GLD's feed is a DEX-state price on crypto hours (section 2). Ticker eligibility should check the feed kind, not only that a feed exists.
- G8. Robinhood's chain docs give a Data Streams verifier proxy on chain 4663 (https://docs.robinhood.com/chain/data-streams, read 14:55 UTC). Access to the streams still needs Chainlink credentials.

> For the Robinhood Chain Mainnet (chain ID 4663), the verifier proxy is located at the following address:

> Robinhood Chain | 0xcE73c8ad08CBDEaCa6078BF0627C8fe0a9a536E7

- Verifier RPC. At about 15:07 UTC, `cast call` from this research machine to https://rpc.mainnet.chain.robinhood.com got HTTP 403 with a Cloudflare challenge page (cf-ray suffix AMS). https://robinhood.drpc.org answered the same calls. The verifier is meant to use the public RPC, so test it from the GreenCloud VPS with the verifier's own HTTP client before relying on it.
- Issuer docs. The example on the Stock Token APIs page is out of date. The live objects also carry tokenDecimals, isin and, per deployment, networkName, itnEnabled and atomicEnabled, none of which the page documents.
- Corporate-action pauses. The issuer gives only approximate times, so they cannot be calendar rules. PriceGuard's oraclePaused, pending multiplier and age checks are the guard (https://docs.robinhood.com/rhj/corporate-actions, read 14:55 UTC):

> In most cases, placing new orders is unavailable from the early morning on the effective date (around 2 AM CET/CEST) and resumes once processing is complete, typically by the start of the US market day (around 3:30 PM CET/CEST).

- Overnight data per symbol. Chainlink warns that the overnight provider can stop a single symbol during a pending corporate action without changing the market status. The calendar cannot see that. PriceGuard's oraclePaused and age checks are the guard.

> the overnight session data provider may disable trading for individual symbols during pending corporate actions such as dividends, splits, or mergers. When this occurs, there will be no overnight session data available for that specific symbol, and this closure will not be reflected in the marketStatus field.

## Appendix A. Daylight-saving computation

Run with Python 3.11.7 in a scratch virtualenv (tzdata 2026d).

```python
"""Find every US Eastern UTC-offset change between 2025-07-01 and 2028-12-31 with zoneinfo.

Scans hourly in UTC, then bisects each change to the exact second.
"""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

NY = ZoneInfo("America/New_York")


def offset_at(ts: int) -> timedelta:
    return datetime.fromtimestamp(ts, tz=timezone.utc).astimezone(NY).utcoffset()


def first_second_with_new_offset(lo: int, hi: int) -> int:
    before = offset_at(lo)
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if offset_at(mid) == before:
            lo = mid
        else:
            hi = mid
    return hi


start = int(datetime(2025, 7, 1, tzinfo=timezone.utc).timestamp())
end = int(datetime(2028, 12, 31, tzinfo=timezone.utc).timestamp())
ts = start
while ts < end:
    nxt = ts + 3600
    if offset_at(ts) != offset_at(nxt):
        t = first_second_with_new_offset(ts, nxt)
        utc = datetime.fromtimestamp(t, tz=timezone.utc)
        local_before = datetime.fromtimestamp(t - 1, tz=timezone.utc).astimezone(NY)
        local_after = utc.astimezone(NY)
        kind = "DST starts (EST to EDT)" if offset_at(t) > offset_at(t - 1) else "DST ends (EDT to EST)"
        print(f"{t} {utc.isoformat().replace('+00:00', 'Z')} {kind}: "
              f"last second {local_before.isoformat()} {local_before.tzname()}, "
              f"first second {local_after.isoformat()} {local_after.tzname()}")
    ts = nxt
```

Output. The last line is outside the requested range and is shown because the script printed it.

```
1762063200 2025-11-02T06:00:00Z DST ends (EDT to EST): last second 2025-11-02T01:59:59-04:00 EDT, first second 2025-11-02T01:00:00-05:00 EST
1772953200 2026-03-08T07:00:00Z DST starts (EST to EDT): last second 2026-03-08T01:59:59-05:00 EST, first second 2026-03-08T03:00:00-04:00 EDT
1793512800 2026-11-01T06:00:00Z DST ends (EDT to EST): last second 2026-11-01T01:59:59-04:00 EDT, first second 2026-11-01T01:00:00-05:00 EST
1805007600 2027-03-14T07:00:00Z DST starts (EST to EDT): last second 2027-03-14T01:59:59-05:00 EST, first second 2027-03-14T03:00:00-04:00 EDT
1825567200 2027-11-07T06:00:00Z DST ends (EDT to EST): last second 2027-11-07T01:59:59-04:00 EDT, first second 2027-11-07T01:00:00-05:00 EST
1836457200 2028-03-12T07:00:00Z DST starts (EST to EDT): last second 2028-03-12T01:59:59-05:00 EST, first second 2028-03-12T03:00:00-04:00 EDT
1857016800 2028-11-05T06:00:00Z DST ends (EDT to EST): last second 2028-11-05T01:59:59-04:00 EDT, first second 2028-11-05T01:00:00-05:00 EST
```

The same instants come out after `zoneinfo.reset_tzpath(to=[])`, which forces the bundled tzdata package instead of the system database.

## Appendix B. NYSE cross-check

```python
"""Cross-check NYSE full-day holidays and early closes for 2026 and 2027.

Sources compared: the table transcribed from nyse.com (NYSE_PAGE below),
exchange_calendars XNYS and pandas_market_calendars NYSE.
"""
from datetime import date, timedelta

import exchange_calendars as xcals
import pandas as pd
import pandas_market_calendars as pmc

NYSE_PAGE_HOLIDAYS = {
    date(2026, 1, 1), date(2026, 1, 19), date(2026, 2, 16), date(2026, 4, 3),
    date(2026, 5, 25), date(2026, 6, 19), date(2026, 7, 3), date(2026, 9, 7),
    date(2026, 11, 26), date(2026, 12, 25),
    date(2027, 1, 1), date(2027, 1, 18), date(2027, 2, 15), date(2027, 3, 26),
    date(2027, 5, 31), date(2027, 6, 18), date(2027, 7, 5), date(2027, 9, 6),
    date(2027, 11, 25), date(2027, 12, 24),
}
NYSE_PAGE_EARLY_CLOSES = {date(2026, 11, 27), date(2026, 12, 24), date(2027, 11, 26)}

weekdays = [date(2026, 1, 1) + timedelta(days=i) for i in range(730)]
weekdays = [d for d in weekdays if d.weekday() < 5 and d.year in (2026, 2027)]

x = xcals.get_calendar("XNYS", start="2025-12-01", end="2028-01-31")
x_sessions = {ts.date() for ts in x.sessions_in_range("2026-01-01", "2027-12-31")}
x_holidays = {d for d in weekdays if d not in x_sessions}
x_early = {ts.date() for ts in x.early_closes if ts.year in (2026, 2027)}
x_early_times = {ts.date(): x.session_close(ts).tz_convert("America/New_York").strftime("%H:%M")
                 for ts in x.early_closes if ts.year in (2026, 2027)}

p = pmc.get_calendar("NYSE")
sched = p.schedule(start_date="2026-01-01", end_date="2027-12-31")
p_sessions = {ts.date() for ts in sched.index}
p_holidays = {d for d in weekdays if d not in p_sessions}
p_early_df = p.early_closes(sched)
p_early = {ts.date() for ts in p_early_df.index}
p_early_times = {ts.date(): row["market_close"].tz_convert("America/New_York").strftime("%H:%M")
                 for ts, row in p_early_df.iterrows()}

print("exchange_calendars", xcals.__version__, "| pandas_market_calendars", pmc.__version__, "| pandas", pd.__version__)
print("weekday holidays: nyse page == exchange_calendars:", NYSE_PAGE_HOLIDAYS == x_holidays)
print("weekday holidays: nyse page == pandas_market_calendars:", NYSE_PAGE_HOLIDAYS == p_holidays)
print("early closes: nyse page == exchange_calendars:", NYSE_PAGE_EARLY_CLOSES == x_early, x_early_times)
print("early closes: nyse page == pandas_market_calendars:", NYSE_PAGE_EARLY_CLOSES == p_early, p_early_times)
for name, s in (("only in xcals", x_holidays ^ NYSE_PAGE_HOLIDAYS), ("only in pmc", p_holidays ^ NYSE_PAGE_HOLIDAYS)):
    if s:
        print(name, sorted(s))
print("trading days 2026:", sum(1 for d in x_sessions if d.year == 2026), "2027:", sum(1 for d in x_sessions if d.year == 2027))
print("Dec 31 2027 is a session:", date(2027, 12, 31) in x_sessions, "| Jul 2 2026 close:",
      x.session_close(pd.Timestamp("2026-07-02")).tz_convert("America/New_York").strftime("%H:%M"),
      "| Jul 2 2027 close:", x.session_close(pd.Timestamp("2027-07-02")).tz_convert("America/New_York").strftime("%H:%M"),
      "| Dec 23 2027 close:", x.session_close(pd.Timestamp("2027-12-23")).tz_convert("America/New_York").strftime("%H:%M"))
```

Output:

```
exchange_calendars 4.13.2 | pandas_market_calendars 5.4.0 | pandas 3.0.6
weekday holidays: nyse page == exchange_calendars: True
weekday holidays: nyse page == pandas_market_calendars: True
early closes: nyse page == exchange_calendars: True {datetime.date(2026, 11, 27): '13:00', datetime.date(2026, 12, 24): '13:00', datetime.date(2027, 11, 26): '13:00'}
early closes: nyse page == pandas_market_calendars: True {datetime.date(2026, 11, 27): '13:00', datetime.date(2026, 12, 24): '13:00', datetime.date(2027, 11, 26): '13:00'}
trading days 2026: 251 2027: 251
Dec 31 2027 is a session: True | Jul 2 2026 close: 16:00 | Jul 2 2027 close: 16:00 | Dec 23 2027 close: 16:00
```

## Appendix C. Rule check against Blue Ocean and the feed history

```python
"""Build the 24/5 session model, check it against Blue Ocean's closure table and against
every round of the four launch feeds on chain 4663.

Needs: pip install exchange_calendars eth-abi
"""
import bisect
import json
import urllib.request
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import exchange_calendars as xcals
from eth_abi import decode, encode

NY = ZoneInfo("America/New_York")
XNYS = xcals.get_calendar("XNYS", start="2025-06-01", end="2028-03-31")
TRADING = {ts.date() for ts in XNYS.sessions}
EARLY = {ts.date() for ts in XNYS.early_closes}


def utc(d: date, hh: int) -> int:
    return int(datetime.combine(d, time(hh), tzinfo=NY).timestamp())


def is_open(ts: int) -> bool:
    """ALL_DAY rule, point-wise."""
    local = datetime.fromtimestamp(ts, tz=timezone.utc).astimezone(NY)
    minute = local.hour * 60 + local.minute
    if minute >= 20 * 60:
        return local.date() + timedelta(days=1) in TRADING
    if local.date() not in TRADING:
        return False
    return minute < (17 if local.date() in EARLY else 20) * 60


def intervals(first: date, last: date):
    """ALL_DAY rule as merged [open, close) intervals: [20:00 on D-1, 20:00 or 17:00 on D)."""
    out = []
    for d in sorted(x for x in TRADING if first <= x <= last):
        o, c = utc(d - timedelta(days=1), 20), utc(d, 17 if d in EARLY else 20)
        if out and out[-1][1] == o:
            out[-1][1] = c
        else:
            out.append([o, c])
    return out


# 1. The two forms of the rule agree minute by minute over 2026 and 2027.
ivs = intervals(date(2025, 12, 1), date(2028, 1, 31))
opens = [o for o, _ in ivs]


def in_intervals(ts: int) -> bool:
    i = bisect.bisect_right(opens, ts) - 1
    return i >= 0 and ivs[i][0] <= ts < ivs[i][1]


lo = int(datetime(2026, 1, 1, 5, tzinfo=timezone.utc).timestamp())
hi = int(datetime(2028, 1, 1, 5, tzinfo=timezone.utc).timestamp())
bad = [t for t in range(lo, hi, 60) if is_open(t) != in_intervals(t)]
print("minutes compared:", (hi - lo) // 60, "disagreements:", len(bad))

# 2. Blue Ocean ATS closed evenings (trading-updates page, 2025, 2026 and 2027 columns).
BLUE_OCEAN = [date(2025, 12, 31), date(2026, 1, 18), date(2026, 2, 15), date(2026, 4, 2), date(2026, 5, 24),
              date(2026, 6, 18), date(2026, 7, 2), date(2026, 9, 6), date(2026, 11, 25), date(2026, 12, 24),
              date(2026, 12, 31), date(2027, 1, 17), date(2027, 2, 14), date(2027, 3, 25), date(2027, 5, 30),
              date(2027, 6, 17), date(2027, 7, 4), date(2027, 9, 5), date(2027, 11, 24), date(2027, 12, 23),
              date(2027, 12, 31)]
closed_evenings = []
d = date(2026, 1, 1)
while d <= date(2027, 12, 31):
    if d.weekday() != 4 and d.weekday() != 5 and not is_open(utc(d, 21)):
        closed_evenings.append(d)
    d += timedelta(days=1)
expected = [x for x in BLUE_OCEAN if date(2026, 1, 1) <= x <= date(2027, 12, 31) and x.weekday() not in (4, 5)]
print("Sun-Thu evenings closed by the model:", len(closed_evenings), "| same as Blue Ocean:", closed_evenings == expected)
print("Blue Ocean evenings the model calls open:", [str(x) for x in BLUE_OCEAN if is_open(utc(x, 21))])

# 3. Every round of the four launch feeds, read through Multicall3.
RPC = "https://robinhood.drpc.org"
MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11"
FEEDS = {"SPY": "0x319724394D3A0e3669269846abE664Cd621f9f6A", "QQQ": "0x80901d846d5D7B030F26B480776EE3b29374C2ae",
         "NVDA": "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15", "AAPL": "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0"}
ROUND = ["uint80", "int256", "uint256", "uint256", "uint80"]


def eth_call(to: str, data: bytes) -> bytes:
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "eth_call",
                       "params": [{"to": to, "data": "0x" + data.hex()}, "latest"]}).encode()
    req = urllib.request.Request(RPC, data=body, headers={"Content-Type": "application/json", "User-Agent": "sleeve"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return bytes.fromhex(json.loads(r.read())["result"][2:])


def rounds(feed: str):
    latest = decode(ROUND, eth_call(feed, bytes.fromhex("feaf968c")))[0]
    phase, last = latest >> 64, latest & (2**64 - 1)
    out = []
    for start in range(1, last + 1, 200):
        ids = range(start, min(start + 200, last + 1))
        calls = [(feed, True, bytes.fromhex("9a6fc8f5") + encode(["uint80"], [(phase << 64) | n])) for n in ids]
        res = decode(["(bool,bytes)[]"], eth_call(MULTICALL3, bytes.fromhex("82ad56cb") + encode(["(address,bool,bytes)[]"], [calls])))[0]
        out += [decode(ROUND, data)[3] for ok, data in res if ok]
    return sorted(out)


def ny(ts: int) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).astimezone(NY).strftime("%a %Y-%m-%d %H:%M:%S %Z")


updates = {sym: rounds(addr) for sym, addr in FEEDS.items()}
for sym, ups in updates.items():
    print(f"{sym}: {len(ups)} rounds, {ny(ups[0])} to {ny(ups[-1])}, outside model: {sum(not in_intervals(u) for u in ups)}")
end = max(u[-1] for u in updates.values())
for o, c in ivs:
    if updates["SPY"][0] - 60 <= o <= end:
        lags = [next(u for u in ups if u >= o) - o for ups in updates.values()]
        print(f"open {ny(o)}: first round after open, seconds (SPY QQQ NVDA AAPL): {lags}")
```

Output, run at 15:27 UTC:

```
minutes compared: 1051200 disagreements: 0
Sun-Thu evenings closed by the model: 19 | same as Blue Ocean: True
Blue Ocean evenings the model calls open: []
SPY: 154 rounds, Sun 2026-06-21 20:00:43 EDT to Fri 2026-10-02 08:30:38 EDT, outside model: 0
QQQ: 401 rounds, Sun 2026-06-21 20:00:43 EDT to Fri 2026-10-02 08:57:12 EDT, outside model: 0
NVDA: 1160 rounds, Sun 2026-06-21 20:00:43 EDT to Fri 2026-10-02 11:17:00 EDT, outside model: 0
AAPL: 699 rounds, Sun 2026-06-21 20:00:44 EDT to Fri 2026-10-02 11:10:08 EDT, outside model: 0
open Sun 2026-06-21 20:00:00 EDT: first round after open, seconds (SPY QQQ NVDA AAPL): [43, 43, 43, 44]
open Sun 2026-06-28 20:00:00 EDT: first round after open, seconds (SPY QQQ NVDA AAPL): [46, 45, 69, 50]
open Sun 2026-07-05 20:00:00 EDT: first round after open, seconds (SPY QQQ NVDA AAPL): [35, 19, 42, 18]
open Sun 2026-07-12 20:00:00 EDT: first round after open, seconds (SPY QQQ NVDA AAPL): [42, 23, 25, 26]
open Sun 2026-07-19 20:00:00 EDT: first round after open, seconds (SPY QQQ NVDA AAPL): [49, 23, 28, 27]
open Sun 2026-07-26 20:00:00 EDT: first round after open, seconds (SPY QQQ NVDA AAPL): [49, 45, 48, 18]
open Sun 2026-08-02 20:00:00 EDT: first round after open, seconds (SPY QQQ NVDA AAPL): [32, 50, 22, 31]
open Sun 2026-08-09 20:00:00 EDT: first round after open, seconds (SPY QQQ NVDA AAPL): [24, 51, 31, 21]
open Sun 2026-08-16 20:00:00 EDT: first round after open, seconds (SPY QQQ NVDA AAPL): [23, 19, 22, 49]
open Sun 2026-08-23 20:00:00 EDT: first round after open, seconds (SPY QQQ NVDA AAPL): [19, 47, 39, 19]
open Sun 2026-08-30 20:00:00 EDT: first round after open, seconds (SPY QQQ NVDA AAPL): [33, 31, 54, 24]
open Mon 2026-09-07 20:00:00 EDT: first round after open, seconds (SPY QQQ NVDA AAPL): [51, 31, 54, 54]
open Sun 2026-09-13 20:00:00 EDT: first round after open, seconds (SPY QQQ NVDA AAPL): [26, 25, 29, 49]
open Sun 2026-09-20 20:00:00 EDT: first round after open, seconds (SPY QQQ NVDA AAPL): [26, 48, 20, 20]
open Sun 2026-09-27 20:00:00 EDT: first round after open, seconds (SPY QQQ NVDA AAPL): [40, 45, 23, 48]
```

## Appendix D. Interval table generator

```python
"""Print every ALL_DAY open interval in 2026 and 2027 as a Markdown table.

Needs: pip install exchange_calendars
"""
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import exchange_calendars as xcals

NY = ZoneInfo("America/New_York")
XNYS = xcals.get_calendar("XNYS", start="2025-06-02", end="2028-03-31")
EARLY = {ts.date() for ts in XNYS.early_closes}


def utc(d: date, hh: int) -> int:
    return int(datetime.combine(d, time(hh), tzinfo=NY).timestamp())


def iso(ts: int) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def ny(ts: int) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).astimezone(NY).strftime("%a %Y-%m-%d %H:%M %Z")


merged = []
for d in (ts.date() for ts in XNYS.sessions_in_range("2026-01-02", "2027-12-31")):
    o, c = utc(d - timedelta(days=1), 20), utc(d, 17 if d in EARLY else 20)
    if merged and merged[-1][1] == o:
        merged[-1][1] = c
        merged[-1][2].append(d)
    else:
        merged.append([o, c, [d]])

print("| # | Opens, New York | Opens, UTC | Closes, New York | Closes, UTC | Trading days |")
print("| --- | --- | --- | --- | --- | --- |")
for n, (o, c, days) in enumerate(merged, 1):
    span = days[0].strftime("%-d %b %Y") if len(days) == 1 else f"{days[0].strftime('%-d %b')} to {days[-1].strftime('%-d %b %Y')}"
    print(f"| {n} | {ny(o)} | {o} {iso(o)} | {ny(c)} | {c} {iso(c)} | {span}, {len(days)} |")
```

## Appendix E. Quote check

The script reads every line in a quote block or a `text` fence in this note, plus the short inline quotes in its INLINE list, and looks for each one in the downloaded copies after the normalization described at the top of this note. The copies are the pages in the sources table as saved at the times shown, the Chainlink source files at the pinned commits, the assets API response headers, the response to the ?symbols=SPY probe, and the description() results of the four feeds.

```python
"""Check every quote line in the research note against downloaded copies of its sources.

Usage: python check_quotes.py <note.md> <sources_dir>
Needs: pip install beautifulsoup4 html2text
"""
import html
import pathlib
import re
import sys

import html2text
from bs4 import BeautifulSoup

INLINE = [
    "(Eastern Standard Time)", "12 AM-5 PM ET on a stock market half-day",
    "with extended-hours trading concluding at 5 PM ET", "late trading sessions will close at 5:00 p.m.",
    "Jul 3, 2026 | US Independence Day (observed) | 13:00", "RH all-day / overnight (24/5) trading flag",
    "Exchange public holidays", "Trading halts (regulatory, news-pending, circuit breakers)",
    "Other operational closures", "Monday 02:00 CET/CEST – Saturday 02:00 CET/CEST",
    "Could not find field \"symbols\" in the type \"crypto_tokenization.service.v1.GetAssetsRequest\".",
    "date: Fri, 02 Oct 2026 14:57:42 GMT", "SPDR Gold Shares • Robinhood Token",
    "RHSPY / USD", "Robinhood QQQ / USD", "RHNVDA / USD", "Robinhood AAPL / USD", "Thursday, December 24",
]


def norm(s: str) -> str:
    s = html.unescape(s)
    s = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", s)
    s = s.replace("**", "").replace("`", "").replace("\\*", "*").replace("|", " ")
    return re.sub(r"\s+", " ", s).strip()


def source_texts(path: pathlib.Path):
    raw = path.read_text(encoding="utf-8", errors="replace")
    yield raw
    if path.suffix == ".html":
        soup = BeautifulSoup(raw, "html.parser")
        for tag in soup.find_all(["script", "style", "noscript"]):
            tag.decompose()
        yield soup.get_text(" ")
        yield soup.get_text("")
        converter = html2text.HTML2Text()
        converter.body_width = 0
        yield converter.handle(str(soup))


def quote_lines(note: str):
    in_text_fence = in_other_fence = False
    for line in note.splitlines():
        if line.startswith("```"):
            if in_text_fence or in_other_fence:
                in_text_fence = in_other_fence = False
            elif line.strip() == "```text":
                in_text_fence = True
            else:
                in_other_fence = True
            continue
        if in_text_fence and line.strip():
            yield line
        elif not in_other_fence and line.startswith("> "):
            yield line[2:]


note_text = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
corpus = [norm(t) for p in sorted(pathlib.Path(sys.argv[2]).iterdir()) for t in source_texts(p)]
quotes = list(quote_lines(note_text)) + INLINE
missing = [q for q in quotes if not any(norm(q) in c for c in corpus)]
print(f"quote lines checked: {len(quotes)}, not found: {len(missing)}")
for q in missing:
    print("  NOT FOUND:", q)
```

Output against this note:

```
quote lines checked: 92, not found: 0
```

## Sources

Read on 2 October 2026. Times are UTC.

| Source | URL | Read |
| --- | --- | --- |
| Robinhood, Stock Token APIs | https://docs.robinhood.com/chain/stock-token-apis | 14:52 |
| Robinhood, Building with Stock Tokens | https://docs.robinhood.com/chain/building-with-stock-tokens | 14:52 |
| Robinhood, Oracles and Price Feeds | https://docs.robinhood.com/chain/oracles-and-price-feeds | 14:52 |
| Robinhood, Stock Tokens | https://docs.robinhood.com/chain/stock-tokens | 14:54 |
| Robinhood, Data Streams | https://docs.robinhood.com/chain/data-streams | 14:55 |
| Robinhood, Notices and Upgrades | https://docs.robinhood.com/chain/notices-and-upgrades | 14:55 |
| Robinhood, RHJ Corporate Actions | https://docs.robinhood.com/rhj/corporate-actions | 14:55 |
| Issuer assets API | https://api.robinhood.com/rhj/assets | 14:57:42 |
| Robinhood 24 Hour Market | https://robinhood.com/us/en/support/articles/24hour-market/ | 14:59 |
| Robinhood stock market closures | https://robinhood.com/us/en/support/articles/stock-market-closures/ | 14:59 |
| Robinhood EU, About Stock Tokens, same mint-window wording | https://robinhood.com/eu/en/support/articles/about-stock-tokens/ | 15:18 |
| Chainlink, 24/5 US Equities User Guide | https://docs.chain.link/data-streams/rwa-streams/24-5-us-equities-user-guide, source commit 10264dba40d789960ddae3d5875eadb32e75cfc7 | 14:54 |
| Chainlink, Data Streams Market Hours | https://docs.chain.link/data-streams/market-hours, source commit 69488b2fc0072bcc4ed99107857e496978528f12 | 14:56 |
| Chainlink, Market Hours, older version | https://github.com/smartcontractkit/documentation/blob/c8a40979e4d98934d015a374b1bae712bfa17ba0/src/content/data-streams/market-hours.mdx | 15:29 |
| Chainlink, Robinhood Tokenized Equities | https://docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood, source commit c068c6ac1c716b64f08e222774707b14b484c5a0 | 14:54 |
| Chainlink, Tokenized Equity Feeds | https://docs.chain.link/data-feeds/tokenized-equity-feeds, source commit 99765ab3d98d09bd62bf5235bebba3e266a94f44 | 15:19 |
| Chainlink feed metadata, Robinhood Chain | https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json | 15:25 |
| NYSE, Holidays and Trading Hours | https://www.nyse.com/markets/hours-calendars, served from https://www.nyse.com/trade/hours-calendars | 14:56 |
| NYSE, Trading Days | https://www.nyse.com/publicdocs/Trading_Days.pdf | 15:09 |
| Blue Ocean ATS, Trading Updates | https://blueocean-tech.io/trading-updates/ | 15:02 |
| Blue Ocean ATS, FAQ | https://blueocean-tech.io/faq/ | 15:02 |
| 15 U.S.C. 260a | https://www.law.cornell.edu/uscode/text/15/260a | 15:04 |
| H.R. 139 as referred to the Senate | https://www.govinfo.gov/content/pkg/BILLS-119hr139rfs/html/BILLS-119hr139rfs.htm | 15:04 |
| H.R. 139 bill status | https://www.govinfo.gov/bulkdata/BILLSTATUS/119/hr/BILLSTATUS-119hr139.xml | 15:05 |
| Launch feeds onchain | getRoundData via https://robinhood.drpc.org and Multicall3 | 15:27 |
| exchange_calendars 4.13.2 and pandas_market_calendars 5.4.0 | PyPI, installed in a scratch virtualenv | 14:53 |
