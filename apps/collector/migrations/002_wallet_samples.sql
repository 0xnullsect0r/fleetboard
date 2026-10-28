-- Wallet balance history, one row per wallet per reporter every few minutes.
CREATE TABLE wallet_samples (
  ts       timestamptz NOT NULL,
  coin     text NOT NULL,
  address  text NOT NULL,
  reporter text NOT NULL,
  balance  double precision NOT NULL,
  unlocked double precision
);

CREATE INDEX wallet_samples_coin_address_ts ON wallet_samples (coin, address, ts DESC);
