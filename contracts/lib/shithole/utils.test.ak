use aiken/builtin
use shithole/types.{ListingDatum}
use shithole/utils

// ============================================================================
// extract_first_bytearray_field — unit tests
// ============================================================================
//
// The cancel-path recovery helper. Reads the first field of a Constr-encoded
// `Data` as a `ByteArray`, without requiring the rest of the datum to decode.
// Used by the listing validator's Cancel branch.
//
// Recovery envelope: `Constr [bytestring, ...]` succeeds; other shapes fail.

const test_lister_pkh =
  #"11111111111111111111111111111111111111111111111111111111"

const test_update_ref_tag =
  #"abababababababababababababababababababababababababababababababab"

// ----------------------------------------------------------------------------
// Positive: extracts the first field correctly across a range of shapes.
// ----------------------------------------------------------------------------

test extract_from_real_listing_datum_with_none_update_ref() {
  // Path used at initial listing creation.
  let datum: Data =
    ListingDatum { lister_pkh: test_lister_pkh, update_ref: None }
  utils.extract_first_bytearray_field(datum) == test_lister_pkh
}

test extract_from_real_listing_datum_with_some_update_ref() {
  // Path used by every listing UTxO after the first swap.
  let datum: Data =
    ListingDatum {
      lister_pkh: test_lister_pkh,
      update_ref: Some(test_update_ref_tag),
    }
  utils.extract_first_bytearray_field(datum) == test_lister_pkh
}

test extract_from_constr_with_int_second_field() {
  // Datum-shape drift case: second field is an Int instead of Option<ByteArray>.
  // Must still recover lister_pkh.
  let data: Data =
    builtin.constr_data(
      0,
      [builtin.b_data(test_lister_pkh), builtin.i_data(42)],
    )
  utils.extract_first_bytearray_field(data) == test_lister_pkh
}

test extract_from_constr_with_list_second_field() {
  // Second field is an arbitrary list.
  let data: Data =
    builtin.constr_data(
      0,
      [builtin.b_data(test_lister_pkh), builtin.list_data([])],
    )
  utils.extract_first_bytearray_field(data) == test_lister_pkh
}

test extract_from_constr_with_extra_trailing_fields() {
  // Datum has MORE fields than expected. We only care about the first.
  let data: Data =
    builtin.constr_data(
      0,
      [
        builtin.b_data(test_lister_pkh),
        builtin.i_data(1),
        builtin.i_data(2),
        builtin.b_data(#"abcd"),
      ],
    )
  utils.extract_first_bytearray_field(data) == test_lister_pkh
}

test extract_from_constr_with_nonzero_tag() {
  // Constr tag != 0. Helper should still extract the first field — it doesn't
  // verify the tag. (This is intentional; the Swap branch separately enforces
  // ListingDatum shape via expect-cast.)
  let data: Data = builtin.constr_data(7, [builtin.b_data(test_lister_pkh)])
  utils.extract_first_bytearray_field(data) == test_lister_pkh
}

// ----------------------------------------------------------------------------
// Negative: shapes outside the recovery envelope must fail.
// ----------------------------------------------------------------------------

test extract_fails_on_non_constr_bytestring() fail {
  // Datum is a raw bytestring, not a Constr.
  let data: Data = builtin.b_data(#"deadbeef")
  utils.extract_first_bytearray_field(data) == #""
}

test extract_fails_on_non_constr_int() fail {
  let data: Data = builtin.i_data(42)
  utils.extract_first_bytearray_field(data) == #""
}

test extract_fails_on_non_constr_list() fail {
  let data: Data = builtin.list_data([builtin.b_data(test_lister_pkh)])
  utils.extract_first_bytearray_field(data) == #""
}

test extract_fails_on_empty_constr() fail {
  // Constr with no fields — head_list panics.
  let data: Data = builtin.constr_data(0, [])
  utils.extract_first_bytearray_field(data) == #""
}

test extract_fails_when_first_field_is_int() fail {
  // First field exists but isn't a bytestring — un_b_data panics.
  let data: Data =
    builtin.constr_data(
      0,
      [builtin.i_data(42), builtin.b_data(test_lister_pkh)],
    )
  utils.extract_first_bytearray_field(data) == #""
}

test extract_fails_when_first_field_is_constr() fail {
  let data: Data =
    builtin.constr_data(
      0,
      [builtin.constr_data(0, []), builtin.b_data(test_lister_pkh)],
    )
  utils.extract_first_bytearray_field(data) == #""
}
