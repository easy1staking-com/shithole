use aiken/fuzz.{and_then, map}
use cardano/address.{Address, VerificationKey}
use shithole/types.{ConfigDatum, is_valid_config_datum, min_lister_fee}

// ============================================================================
// Fuzzers — ConfigDatum
// ============================================================================

fn pkh_fuzzer() -> Fuzzer<ByteArray> {
  fuzz.bytearray_fixed(28)
}

fn address_fuzzer() -> Fuzzer<Address> {
  let pkh <- map(pkh_fuzzer())
  Address { payment_credential: VerificationKey(pkh), stake_credential: None }
}

/// Generate a ConfigDatum satisfying `is_valid_config_datum`:
///   m >= 1, protocol_fee >= 0, lister_fee >= min_lister_fee.
pub fn valid_config_datum() -> Fuzzer<ConfigDatum> {
  let m <- and_then(fuzz.int_between(1, 100_000))
  let protocol_fee <- and_then(fuzz.int_between(0, 1_000_000_000))
  let lister_fee <- and_then(fuzz.int_between(min_lister_fee, 1_000_000_000))
  let treasury_addr <- and_then(address_fuzzer())
  let admin_pkh <- map(pkh_fuzzer())
  ConfigDatum { m, protocol_fee, lister_fee, treasury_addr, admin_pkh }
}

/// Generate a ConfigDatum with exactly one field violating the invariant.
/// Per-field invalid buckets:
///   - m: invalid if < 1               (must be a positive integer)
///   - protocol_fee: invalid if < 0    (0 is the floor; admin can charge nothing)
///   - lister_fee: invalid if < min_lister_fee
pub fn invalid_config_datum() -> Fuzzer<ConfigDatum> {
  let base <- and_then(valid_config_datum())
  let field <- and_then(fuzz.int_between(0, 2))
  when field is {
    0 -> {
      let bad <-
        map(fuzz.either(fuzz.constant(0), fuzz.int_between(-1_000_000, -1)))
      ConfigDatum { ..base, m: bad }
    }
    1 -> {
      let bad <- map(fuzz.int_between(-1_000_000_000, -1))
      ConfigDatum { ..base, protocol_fee: bad }
    }
    _ -> {
      let bad <- map(fuzz.int_between(0, min_lister_fee - 1))
      ConfigDatum { ..base, lister_fee: bad }
    }
  }
}

// ============================================================================
// is_valid_config_datum — Property tests
// ============================================================================

test prop_valid_config_datum_always_accepted(datum via valid_config_datum()) {
  is_valid_config_datum(datum)
}

test prop_invalid_config_datum_always_rejected(datum via invalid_config_datum()) {
  !is_valid_config_datum(datum)
}

/// Sanity: corruption is per-field, not "the entire datum is broken." A
/// fuzz-generated valid datum and a fuzz-generated invalid datum should
/// always classify differently.
test prop_valid_and_invalid_are_distinguishable(
  inputs via fuzz.both(valid_config_datum(), invalid_config_datum()),
) {
  let (good, bad) = inputs
  is_valid_config_datum(good) && !is_valid_config_datum(bad)
}
