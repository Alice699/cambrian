/* Cambrian - a deterministic digital-life program for Thru Betanet. */

#include "cambrian.h"

#include <stddef.h>

static void
require_condition( int condition, ulong error_code ) {
  if( !condition ) tsdk_revert( error_code );
}

static tsdk_txn_t const *
current_txn( void ) {
  tsdk_txn_t const * txn = tsdk_get_txn();
  require_condition( txn != NULL, CAMBRIAN_ERR_ACCOUNT_DATA );
  return txn;
}

static tsdk_block_ctx_t const *
current_block( void ) {
  tsdk_block_ctx_t const * block = tsdk_get_current_block_ctx();
  require_condition( block != NULL, CAMBRIAN_ERR_CLOCK );
  return block;
}

static tn_pubkey_t const *
account_address( ushort account_idx ) {
  tsdk_txn_t const * txn = current_txn();
  require_condition( tsdk_is_account_idx_valid( account_idx ),
                     CAMBRIAN_ERR_BAD_ACCOUNT_INDEX );
  return &tsdk_txn_get_acct_addrs( txn )[ account_idx ];
}

#include "cambrian_controller.h"

static void
require_organism_index( ushort account_idx, int writable ) {
  tsdk_txn_t const * txn = current_txn();
  require_condition( account_idx >= 2U,
                     CAMBRIAN_ERR_BAD_ACCOUNT_INDEX );
  require_condition( tsdk_is_account_idx_valid( account_idx ),
                     CAMBRIAN_ERR_BAD_ACCOUNT_INDEX );
  if( writable ) {
    require_condition( tsdk_txn_is_account_idx_writable( txn, account_idx ),
                       CAMBRIAN_ERR_ACCOUNT_NOT_WRITABLE );
  }
}

static void
copy_state_bytes( void * out,
                  cambrian_organism_t const * state,
                  ulong offset,
                  ulong size ) {
  memcpy( out, ((uchar const *)state) + offset, size );
}

static void
write_state_bytes( cambrian_organism_t * state,
                   ulong                 offset,
                   void const *          data,
                   ulong                 size ) {
  memcpy( ((uchar *)state) + offset, data, size );
}

static uchar const *
state_bytes( cambrian_organism_t const * state, ulong offset ) {
  return ((uchar const *)state) + offset;
}

static uchar *
mutable_state_bytes( cambrian_organism_t * state, ulong offset ) {
  return ((uchar *)state) + offset;
}

static int
same_pubkey( tn_pubkey_t const * left, tn_pubkey_t const * right ) {
  return memcmp( left->uc, right->uc, 32UL ) == 0;
}

static int
bytes_nonzero( uchar const * bytes, ulong size ) {
  ulong i;
  for( i = 0UL; i < size; i++ ) {
    if( bytes[ i ] != 0U ) return 1;
  }
  return 0;
}

static ulong
saturating_add( ulong left, ulong right, ulong maximum ) {
  if( left >= maximum ) return maximum;
  if( right >= maximum - left ) return maximum;
  return left + right;
}

static ulong
floor_sub( ulong left, ulong right ) {
  return left > right ? left - right : 0UL;
}

static void
encode_u16_le( uchar out[ 2 ], ushort value ) {
  out[ 0 ] = (uchar)( value & 0xFFU );
  out[ 1 ] = (uchar)( value >> 8U );
}

static void
encode_u64_le( uchar out[ 8 ], ulong value ) {
  uint i;
  for( i = 0U; i < 8U; i++ ) {
    out[ i ] = (uchar)( value >> (i * 8U) );
  }
}

static void
hash_begin( tsdk_sha256_t * sha, char const * domain, ulong domain_size ) {
  (void)tsdk_sha256_init( sha );
  (void)tsdk_sha256_append( sha, domain, domain_size );
}

static void
hash_append( tsdk_sha256_t * sha, void const * data, ulong size ) {
  (void)tsdk_sha256_append( sha, data, size );
}

static void
hash_append_u16( tsdk_sha256_t * sha, ushort value ) {
  uchar encoded[ 2 ];
  encode_u16_le( encoded, value );
  hash_append( sha, encoded, 2UL );
}

static void
hash_append_u64( tsdk_sha256_t * sha, ulong value ) {
  uchar encoded[ 8 ];
  encode_u64_le( encoded, value );
  hash_append( sha, encoded, 8UL );
}

static void
hash_finish( tsdk_sha256_t * sha, tn_hash_t * out ) {
  (void)tsdk_sha256_fini( sha, out->uc );
}

static void
hash_append_state_hash( tsdk_sha256_t * sha,
                        cambrian_organism_t const * state,
                        ulong offset ) {
  hash_append( sha, state_bytes( state, offset ), 32UL );
}

static uchar
popcount8( uchar value ) {
  uchar count = 0U;
  while( value != 0U ) {
    count = (uchar)( count + (uchar)( value & 1U ) );
    value = (uchar)( value >> 1U );
  }
  return count;
}

static ushort
hamming_distance( uchar const * left, uchar const * right ) {
  uint i;
  ushort distance = 0U;
  for( i = 0U; i < 32U; i++ ) {
    distance = (ushort)( distance +
                         (ushort)popcount8( (uchar)( left[ i ] ^ right[ i ] ) ) );
  }
  return distance;
}

static ushort
mutation_bit( tn_hash_t const * digest ) {
  /* A genome is 32 bytes, so the mutation index must stay in [0, 255]. */
  return (ushort)( ((ushort)( digest->uc[ 1 ] & 31U ) << 3U) |
                   ((ushort)digest->uc[ 2 ] & 7U) );
}

static int
controller_authorized( cambrian_organism_t const * state ) {
  tn_pubkey_t controller;
  copy_state_bytes( controller.uc, state,
                    (ulong)offsetof( cambrian_organism_t, controller ), 32UL );
  return tsdk_is_account_authorized_by_pubkey( &controller );
}

static void
load_organism( ushort account_idx,
               cambrian_organism_t * out,
               int writable ) {
  tsdk_account_meta_t const * meta;
  void * data;

  require_organism_index( account_idx, writable );
  require_condition( tsdk_account_exists( account_idx ),
                     CAMBRIAN_ERR_ACCOUNT_MISSING );

  meta = tsdk_get_account_meta( account_idx );
  require_condition( meta != NULL, CAMBRIAN_ERR_ACCOUNT_DATA );
  require_condition( meta->data_sz == sizeof( cambrian_organism_t ),
                     CAMBRIAN_ERR_ACCOUNT_LAYOUT );
  require_condition( same_pubkey( &meta->owner,
                                  tsdk_get_current_program_acc_addr() ),
                     CAMBRIAN_ERR_ACCOUNT_OWNER );

  if( writable ) {
    require_condition( tsys_set_account_data_writable( account_idx ) ==
                       TSDK_SUCCESS, CAMBRIAN_ERR_ACCOUNT_NOT_WRITABLE );
  }

  data = tsdk_get_account_data_ptr( account_idx );
  require_condition( data != NULL, CAMBRIAN_ERR_ACCOUNT_DATA );
  memcpy( out, data, sizeof( cambrian_organism_t ) );

  require_condition( out->magic == (uint)CAMBRIAN_MAGIC,
                     CAMBRIAN_ERR_ACCOUNT_LAYOUT );
  require_condition( out->version == CAMBRIAN_VERSION,
                     CAMBRIAN_ERR_ACCOUNT_LAYOUT );
  require_condition( out->status == CAMBRIAN_STATUS_ALIVE ||
                     out->status == CAMBRIAN_STATUS_DORMANT ||
                     out->status == CAMBRIAN_STATUS_DEAD,
                     CAMBRIAN_ERR_INVALID_STATUS );
}

static void
store_organism( ushort account_idx, cambrian_organism_t const * state ) {
  void * data = tsdk_get_account_data_ptr( account_idx );
  require_condition( data != NULL, CAMBRIAN_ERR_ACCOUNT_DATA );
  memcpy( data, state, sizeof( cambrian_organism_t ) );
}

static void
create_organism_account( ushort account_idx,
                         uchar const seed[ TN_SEED_SIZE ],
                         void const * proof,
                         ulong proof_size ) {
  tn_pubkey_t expected_address;
  tn_pubkey_t const * actual_address;
  ulong result;

  require_organism_index( account_idx, 1 );
  require_condition( !tsdk_account_exists( account_idx ),
                     CAMBRIAN_ERR_ACCOUNT_EXISTS );
  require_condition( proof != NULL && proof_size != 0UL,
                     CAMBRIAN_ERR_INVALID_PROOF );
  require_condition( proof_size <= CAMBRIAN_MAX_PROOF_SIZE,
                     CAMBRIAN_ERR_INVALID_PROOF );

  actual_address = account_address( account_idx );
  require_condition( tsdk_create_program_defined_account_address(
                       tsdk_get_current_program_acc_addr(), 0U, seed,
                       &expected_address ) != NULL,
                     CAMBRIAN_ERR_ADDRESS );
  require_condition( same_pubkey( actual_address, &expected_address ),
                     CAMBRIAN_ERR_INVALID_SEED );

  result = tsys_account_create( account_idx, seed, proof, proof_size );
  require_condition( result == TSDK_SUCCESS, CAMBRIAN_ERR_ACCOUNT_CREATE );

  result = tsys_set_account_data_writable( account_idx );
  require_condition( result == TSDK_SUCCESS,
                     CAMBRIAN_ERR_ACCOUNT_NOT_WRITABLE );

  result = tsys_account_resize( account_idx, sizeof( cambrian_organism_t ) );
  require_condition( result == TSDK_SUCCESS, CAMBRIAN_ERR_ACCOUNT_RESIZE );
}

static void
emit_event( void const * event, ulong event_size ) {
  require_condition( tsys_emit_event( event, event_size ) == TSDK_SUCCESS,
                     CAMBRIAN_ERR_EVENT );
}

static void
emit_typed_event( uchar tag, void const * payload, ulong payload_size ) {
  /* ReproduceEvent is the largest current event payload. */
  uchar event_bytes[ 1UL + sizeof( cambrian_reproduce_event_t ) ];
  require_condition( payload_size <= sizeof( event_bytes ) - 1UL,
                     CAMBRIAN_ERR_EVENT );
  event_bytes[ 0 ] = tag;
  memcpy( event_bytes + 1UL, payload, payload_size );
  emit_event( event_bytes, 1UL + payload_size );
}

static void
parse_dynamic_size( uchar const * body,
                    ulong body_size,
                    ulong fixed_size,
                    ulong proof_offset,
                    ulong * proof_size_out ) {
  uint proof_size;

  require_condition( body_size >= fixed_size, CAMBRIAN_ERR_BAD_SIZE );
  proof_size = TSDK_LOAD( uint, body + proof_offset );
  require_condition( (ulong)proof_size <= CAMBRIAN_MAX_PROOF_SIZE,
                     CAMBRIAN_ERR_INVALID_PROOF );
  require_condition( body_size == fixed_size + (ulong)proof_size,
                     CAMBRIAN_ERR_BAD_SIZE );
  require_condition( proof_size != 0U, CAMBRIAN_ERR_INVALID_PROOF );
  *proof_size_out = (ulong)proof_size;
}

static void
handle_birth( uchar const * body, ulong body_size, int wallet_owned ) {
  ulong fixed_size = wallet_owned ? (ulong)sizeof( cambrian_wallet_birth_args_t )
                                 : (ulong)sizeof( cambrian_birth_args_t );
  ulong proof_offset = wallet_owned ? (ulong)offsetof( cambrian_wallet_birth_args_t, proof_size )
                                   : (ulong)offsetof( cambrian_birth_args_t, proof_size );
  ulong seed_offset = wallet_owned ? (ulong)offsetof( cambrian_wallet_birth_args_t, seed )
                                  : (ulong)offsetof( cambrian_birth_args_t, seed );
  ulong entropy_offset = wallet_owned ? (ulong)offsetof( cambrian_wallet_birth_args_t, entropy )
                                     : (ulong)offsetof( cambrian_birth_args_t, entropy );
  ulong proof_size;
  uchar const * seed;
  uchar const * entropy;
  uchar const * proof;
  cambrian_organism_t state;
  cambrian_birth_event_t event;
  tn_hash_t digest;
  tsdk_sha256_t sha;
  tn_pubkey_t const * controller;
  tn_pubkey_t const * organism;
  tsdk_block_ctx_t const * block;
  tsdk_txn_t const * txn;
  ushort organism_idx;
  ushort controller_idx;

  parse_dynamic_size( body, body_size, fixed_size,
                      proof_offset,
                      &proof_size );

  organism_idx = TSDK_LOAD( ushort, body );
  controller_idx = wallet_owned ? TSDK_LOAD( ushort, body + 2UL ) : 0U;
  seed = body + seed_offset;
  entropy = body + entropy_offset;
  proof = body + fixed_size;
  require_condition( bytes_nonzero( seed, TN_SEED_SIZE ),
                     CAMBRIAN_ERR_INVALID_SEED );
  /* CPI authorization comes from Thru Wallet's validated selected account, not
     from a caller-provided address or the unrelated outer fee payer. */
  controller = resolve_birth_controller( controller_idx, organism_idx, wallet_owned );
  create_organism_account( organism_idx, seed, proof, proof_size );

  txn = current_txn();
  block = current_block();
  organism = account_address( organism_idx );

  hash_begin( &sha, "CAMBRIAN/GENOME/v1",
              (ulong)(sizeof( "CAMBRIAN/GENOME/v1" ) - 1UL) );
  hash_append( &sha, seed, 32UL );
  hash_append( &sha, entropy, 32UL );
  hash_append( &sha, controller->uc, 32UL );
  hash_append( &sha, block->cur_block_hash.uc, 32UL );
  hash_append_u64( &sha, block->slot );
  hash_append_u64( &sha, tsdk_txn_get_nonce( txn ) );
  hash_finish( &sha, &digest );

  memset( &state, 0, sizeof( state ) );
  state.magic = (uint)CAMBRIAN_MAGIC;
  state.version = CAMBRIAN_VERSION;
  state.status = CAMBRIAN_STATUS_ALIVE;
  state.generation = 0U;
  write_state_bytes( &state,
                     (ulong)offsetof( cambrian_organism_t, controller ),
                     controller->uc, 32UL );
  write_state_bytes( &state,
                     (ulong)offsetof( cambrian_organism_t, genome ),
                     digest.uc, 32UL );

  hash_begin( &sha, "CAMBRIAN/LINEAGE/v1",
              (ulong)(sizeof( "CAMBRIAN/LINEAGE/v1" ) - 1UL) );
  hash_append( &sha, digest.uc, 32UL );
  hash_append( &sha, organism->uc, 32UL );
  hash_append( &sha, controller->uc, 32UL );
  hash_append( &sha, block->cur_block_hash.uc, 32UL );
  hash_append_u64( &sha, block->slot );
  hash_finish( &sha, &digest );
  write_state_bytes( &state,
                     (ulong)offsetof( cambrian_organism_t, lineage ),
                     digest.uc, 32UL );

  hash_begin( &sha, "CAMBRIAN/MEMORY/v1",
              (ulong)(sizeof( "CAMBRIAN/MEMORY/v1" ) - 1UL) );
  hash_append( &sha, state_bytes( &state,
                                  (ulong)offsetof( cambrian_organism_t, lineage ) ),
               32UL );
  hash_append( &sha, block->cur_block_hash.uc, 32UL );
  hash_append_u64( &sha, block->slot );
  hash_finish( &sha, &digest );
  write_state_bytes( &state,
                     (ulong)offsetof( cambrian_organism_t, memory ),
                     digest.uc, 32UL );

  state.born_slot = block->slot;
  state.last_pulse_slot = block->slot;
  state.age = 0UL;
  state.energy = CAMBRIAN_INITIAL_ENERGY;
  state.vitality = saturating_add( CAMBRIAN_INITIAL_VITALITY,
                                   (ulong)state_bytes( &state,
                                     (ulong)offsetof( cambrian_organism_t,
                                                      genome ) )[ 0 ],
                                   CAMBRIAN_MAX_VITALITY );
  state.pulse_count = 0UL;
  state.encounter_count = 0UL;
  state.offspring_count = 0UL;
  store_organism( organism_idx, &state );

  memset( &event, 0, sizeof( event ) );
  event.slot = block->slot;
  event.generation = state.generation;
  event.energy = state.energy;
  event.vitality = state.vitality;
  memcpy( ((uchar *)&event) +
            (ulong)offsetof( cambrian_birth_event_t, organism ),
          organism->uc, 32UL );
  memcpy( ((uchar *)&event) +
            (ulong)offsetof( cambrian_birth_event_t, controller ),
          controller->uc, 32UL );
  memcpy( ((uchar *)&event) +
            (ulong)offsetof( cambrian_birth_event_t, genome ),
          state_bytes( &state,
                       (ulong)offsetof( cambrian_organism_t, genome ) ), 32UL );
  memcpy( ((uchar *)&event) +
            (ulong)offsetof( cambrian_birth_event_t, lineage ),
          state_bytes( &state,
                       (ulong)offsetof( cambrian_organism_t, lineage ) ), 32UL );
  emit_typed_event( CAMBRIAN_EVENT_BIRTH, &event, sizeof( event ) );
}

static void
handle_pulse( uchar const * body, ulong body_size ) {
  ulong expected_size = (ulong)sizeof( cambrian_pulse_args_t );
  ushort organism_idx;
  ulong catalyst;
  ulong elapsed;
  ulong energy_before;
  ulong cost;
  ulong damage_or_recovery;
  ushort changed_bit = CAMBRIAN_NO_MUTATION;
  cambrian_organism_t state;
  cambrian_pulse_event_t event;
  tn_hash_t digest;
  tsdk_sha256_t sha;
  tsdk_block_ctx_t const * block;
  tn_pubkey_t const * organism;

  require_condition( body_size == expected_size, CAMBRIAN_ERR_BAD_SIZE );
  organism_idx = TSDK_LOAD( ushort, body );
  catalyst = TSDK_LOAD( ulong, body + 2UL );
  load_organism( organism_idx, &state, 1 );
  require_condition( controller_authorized( &state ),
                     CAMBRIAN_ERR_UNAUTHORIZED );
  require_condition( state.status != CAMBRIAN_STATUS_DEAD,
                     CAMBRIAN_ERR_INVALID_STATUS );

  block = current_block();
  require_condition( block->slot > state.last_pulse_slot,
                     CAMBRIAN_ERR_CLOCK );
  elapsed = block->slot - state.last_pulse_slot;
  require_condition( elapsed <= CAMBRIAN_MAX_PULSE_ELAPSED,
                     CAMBRIAN_ERR_CLOCK );
  energy_before = state.energy;

  hash_begin( &sha, "CAMBRIAN/PULSE/v1",
              (ulong)(sizeof( "CAMBRIAN/PULSE/v1" ) - 1UL) );
  hash_append_state_hash( &sha, &state,
                          (ulong)offsetof( cambrian_organism_t, genome ) );
  hash_append_state_hash( &sha, &state,
                          (ulong)offsetof( cambrian_organism_t, memory ) );
  hash_append( &sha, block->cur_block_hash.uc, 32UL );
  hash_append_u64( &sha, catalyst );
  hash_append_u64( &sha, state.pulse_count );
  hash_finish( &sha, &digest );

  cost = elapsed * (3UL + ((ulong)digest.uc[ 0 ] & 7UL));
  state.energy = floor_sub( state.energy, cost );
  if( state.energy < 128UL ) {
    damage_or_recovery = elapsed + 3UL;
    state.vitality = floor_sub( state.vitality, damage_or_recovery );
  } else if( state.energy > 1024UL ) {
    damage_or_recovery = (elapsed / 4UL) + 1UL;
    state.vitality = saturating_add( state.vitality, damage_or_recovery,
                                    CAMBRIAN_MAX_VITALITY );
  }

  state.age = saturating_add( state.age, elapsed, ~0UL );
  state.last_pulse_slot = block->slot;
  state.pulse_count = saturating_add( state.pulse_count, 1UL, ~0UL );

  if( state.vitality == 0UL ) {
    state.status = CAMBRIAN_STATUS_DEAD;
  } else if( state.energy == 0UL || state.energy < 256UL ||
             state.vitality < 256UL ) {
    state.status = CAMBRIAN_STATUS_DORMANT;
  } else {
    state.status = CAMBRIAN_STATUS_ALIVE;
  }

  if( state.status != CAMBRIAN_STATUS_DEAD && digest.uc[ 0 ] < 32U ) {
    changed_bit = mutation_bit( &digest );
    mutable_state_bytes( &state,
                         (ulong)offsetof( cambrian_organism_t, genome ) )[
                           changed_bit / 8U ] ^= (uchar)( 1U << (changed_bit % 8U) );
  }

  hash_begin( &sha, "CAMBRIAN/PULSE-LINEAGE/v1",
              (ulong)(sizeof( "CAMBRIAN/PULSE-LINEAGE/v1" ) - 1UL) );
  hash_append_state_hash( &sha, &state,
                          (ulong)offsetof( cambrian_organism_t, lineage ) );
  hash_append( &sha, digest.uc, 32UL );
  hash_append_u64( &sha, block->slot );
  hash_append_u16( &sha, changed_bit );
  hash_finish( &sha, &digest );
  write_state_bytes( &state,
                     (ulong)offsetof( cambrian_organism_t, lineage ),
                     digest.uc, 32UL );

  hash_begin( &sha, "CAMBRIAN/PULSE-MEMORY/v1",
              (ulong)(sizeof( "CAMBRIAN/PULSE-MEMORY/v1" ) - 1UL) );
  hash_append_state_hash( &sha, &state,
                          (ulong)offsetof( cambrian_organism_t, memory ) );
  hash_append_state_hash( &sha, &state,
                          (ulong)offsetof( cambrian_organism_t, genome ) );
  hash_append( &sha, digest.uc, 32UL );
  hash_append_u64( &sha, state.age );
  hash_append_u64( &sha, state.energy );
  hash_append_u64( &sha, state.vitality );
  hash_finish( &sha, &digest );
  write_state_bytes( &state,
                     (ulong)offsetof( cambrian_organism_t, memory ),
                     digest.uc, 32UL );

  organism = account_address( organism_idx );
  store_organism( organism_idx, &state );

  memset( &event, 0, sizeof( event ) );
  event.slot = block->slot;
  event.age = state.age;
  event.energy_before = energy_before;
  event.energy_after = state.energy;
  event.vitality = state.vitality;
  event.status = state.status;
  event.mutation_bit = changed_bit;
  memcpy( ((uchar *)&event) +
            (ulong)offsetof( cambrian_pulse_event_t, organism ),
          organism->uc, 32UL );
  memcpy( ((uchar *)&event) +
            (ulong)offsetof( cambrian_pulse_event_t, genome ),
          state_bytes( &state,
                       (ulong)offsetof( cambrian_organism_t, genome ) ), 32UL );
  memcpy( ((uchar *)&event) +
            (ulong)offsetof( cambrian_pulse_event_t, lineage ),
          state_bytes( &state,
                       (ulong)offsetof( cambrian_organism_t, lineage ) ), 32UL );
  emit_typed_event( CAMBRIAN_EVENT_PULSE, &event, sizeof( event ) );
}

static void
handle_encounter( uchar const * body, ulong body_size ) {
  ulong expected_size = (ulong)sizeof( cambrian_encounter_args_t );
  ushort actor_idx;
  ushort donor_idx;
  ulong catalyst;
  ushort compatibility;
  uchar outcome;
  uchar gene_transferred = 0U;
  ulong energy_before;
  ulong energy_delta;
  ushort learned_bit = CAMBRIAN_NO_MUTATION;
  cambrian_organism_t actor;
  cambrian_organism_t donor;
  cambrian_encounter_event_t event;
  tn_hash_t digest;
  tsdk_sha256_t sha;
  tsdk_block_ctx_t const * block;
  tn_pubkey_t const * actor_address_ptr;
  tn_pubkey_t const * donor_address_ptr;

  require_condition( body_size == expected_size, CAMBRIAN_ERR_BAD_SIZE );
  actor_idx = TSDK_LOAD( ushort, body );
  donor_idx = TSDK_LOAD( ushort, body + 2UL );
  catalyst = TSDK_LOAD( ulong, body + 4UL );
  require_condition( actor_idx != donor_idx, CAMBRIAN_ERR_SAME_ORGANISM );
  actor_address_ptr = account_address( actor_idx );
  donor_address_ptr = account_address( donor_idx );
  require_condition( !same_pubkey( actor_address_ptr, donor_address_ptr ),
                     CAMBRIAN_ERR_SAME_ORGANISM );

  load_organism( actor_idx, &actor, 1 );
  load_organism( donor_idx, &donor, 0 );
  require_condition( controller_authorized( &actor ),
                     CAMBRIAN_ERR_UNAUTHORIZED );
  require_condition( actor.status != CAMBRIAN_STATUS_DEAD &&
                     donor.status != CAMBRIAN_STATUS_DEAD,
                     CAMBRIAN_ERR_INVALID_STATUS );

  block = current_block();
  compatibility = (ushort)( 256U -
                            hamming_distance(
                              state_bytes( &actor,
                                (ulong)offsetof( cambrian_organism_t, genome ) ),
                              state_bytes( &donor,
                                (ulong)offsetof( cambrian_organism_t, genome ) ) ) );
  energy_before = actor.energy;

  hash_begin( &sha, "CAMBRIAN/ENCOUNTER/v1",
              (ulong)(sizeof( "CAMBRIAN/ENCOUNTER/v1" ) - 1UL) );
  hash_append_state_hash( &sha, &actor,
                          (ulong)offsetof( cambrian_organism_t, genome ) );
  hash_append_state_hash( &sha, &donor,
                          (ulong)offsetof( cambrian_organism_t, genome ) );
  hash_append_state_hash( &sha, &actor,
                          (ulong)offsetof( cambrian_organism_t, lineage ) );
  hash_append_state_hash( &sha, &donor,
                          (ulong)offsetof( cambrian_organism_t, lineage ) );
  hash_append( &sha, block->cur_block_hash.uc, 32UL );
  hash_append_u64( &sha, catalyst );
  hash_append_u64( &sha, actor.encounter_count );
  hash_finish( &sha, &digest );

  if( compatibility >= 192U ) {
    outcome = 1U; /* symbiosis */
    energy_delta = 128UL;
    gene_transferred = 1U;
  } else if( compatibility >= 96U ) {
    outcome = 2U; /* adaptation */
    energy_delta = 32UL;
    gene_transferred = 1U;
  } else {
    outcome = 3U; /* stress */
    energy_delta = 96UL;
  }

  if( gene_transferred != 0U ) {
    learned_bit = mutation_bit( &digest );
    mutable_state_bytes( &actor,
                         (ulong)offsetof( cambrian_organism_t, genome ) )[
                           learned_bit / 8U ] =
      (uchar)( (mutable_state_bytes( &actor,
                                     (ulong)offsetof( cambrian_organism_t,
                                                      genome ) )[ learned_bit / 8U ] &
                (uchar)~( 1U << (learned_bit % 8U) )) |
              (state_bytes( &donor,
                            (ulong)offsetof( cambrian_organism_t, genome ) )[
                              learned_bit / 8U ] &
               (uchar)( 1U << (learned_bit % 8U) )) );
  }

  if( outcome == 3U ) {
    actor.energy = floor_sub( actor.energy, energy_delta );
  } else {
    actor.energy = saturating_add( actor.energy, energy_delta,
                                   CAMBRIAN_MAX_ENERGY );
  }
  actor.encounter_count = saturating_add( actor.encounter_count, 1UL, ~0UL );

  if( actor.vitality == 0UL ) {
    actor.status = CAMBRIAN_STATUS_DEAD;
  } else if( actor.energy == 0UL || actor.energy < 256UL ) {
    actor.status = CAMBRIAN_STATUS_DORMANT;
  } else {
    actor.status = CAMBRIAN_STATUS_ALIVE;
  }

  hash_begin( &sha, "CAMBRIAN/ENCOUNTER-MEMORY/v1",
              (ulong)(sizeof( "CAMBRIAN/ENCOUNTER-MEMORY/v1" ) - 1UL) );
  hash_append_state_hash( &sha, &actor,
                          (ulong)offsetof( cambrian_organism_t, memory ) );
  hash_append_state_hash( &sha, &donor,
                          (ulong)offsetof( cambrian_organism_t, genome ) );
  hash_append_state_hash( &sha, &donor,
                          (ulong)offsetof( cambrian_organism_t, lineage ) );
  hash_append( &sha, digest.uc, 32UL );
  hash_append_u16( &sha, compatibility );
  hash_append_u16( &sha, learned_bit );
  hash_finish( &sha, &digest );
  write_state_bytes( &actor,
                     (ulong)offsetof( cambrian_organism_t, memory ),
                     digest.uc, 32UL );

  if( gene_transferred != 0U ) {
    hash_begin( &sha, "CAMBRIAN/ENCOUNTER-LINEAGE/v1",
                (ulong)(sizeof( "CAMBRIAN/ENCOUNTER-LINEAGE/v1" ) - 1UL) );
    hash_append_state_hash( &sha, &actor,
                            (ulong)offsetof( cambrian_organism_t, lineage ) );
    hash_append_state_hash( &sha, &donor,
                            (ulong)offsetof( cambrian_organism_t, lineage ) );
    hash_append( &sha, digest.uc, 32UL );
    hash_finish( &sha, &digest );
    write_state_bytes( &actor,
                       (ulong)offsetof( cambrian_organism_t, lineage ),
                       digest.uc, 32UL );
  }

  store_organism( actor_idx, &actor );
  memset( &event, 0, sizeof( event ) );
  event.compatibility = compatibility;
  event.outcome = outcome;
  event.gene_transferred = gene_transferred;
  event.energy_before = energy_before;
  event.energy_after = actor.energy;
  event.encounter_count = actor.encounter_count;
  memcpy( ((uchar *)&event) +
            (ulong)offsetof( cambrian_encounter_event_t, actor ),
          actor_address_ptr->uc, 32UL );
  memcpy( ((uchar *)&event) +
            (ulong)offsetof( cambrian_encounter_event_t, donor ),
          donor_address_ptr->uc, 32UL );
  memcpy( ((uchar *)&event) +
            (ulong)offsetof( cambrian_encounter_event_t, genome ),
          state_bytes( &actor,
                       (ulong)offsetof( cambrian_organism_t, genome ) ), 32UL );
  memcpy( ((uchar *)&event) +
            (ulong)offsetof( cambrian_encounter_event_t, memory ),
          state_bytes( &actor,
                       (ulong)offsetof( cambrian_organism_t, memory ) ), 32UL );
  emit_typed_event( CAMBRIAN_EVENT_ENCOUNTER, &event, sizeof( event ) );
}

static void
handle_reproduce( uchar const * body, ulong body_size ) {
  ulong fixed_size = (ulong)sizeof( cambrian_reproduce_args_t );
  ulong proof_size;
  ushort parent_a_idx;
  ushort parent_b_idx;
  ushort child_idx;
  uchar const * seed;
  uchar const * entropy;
  uchar const * proof;
  cambrian_organism_t parent_a;
  cambrian_organism_t parent_b;
  cambrian_organism_t child;
  cambrian_reproduce_event_t event;
  tn_hash_t digest;
  tsdk_sha256_t sha;
  tsdk_block_ctx_t const * block;
  tn_pubkey_t const * parent_a_address;
  tn_pubkey_t const * parent_b_address;
  tn_pubkey_t const * child_address;
  ushort generation;
  ushort changed_bit;
  uint i;

  parse_dynamic_size( body, body_size, fixed_size,
                      (ulong)offsetof( cambrian_reproduce_args_t, proof_size ),
                      &proof_size );
  parent_a_idx = TSDK_LOAD( ushort, body );
  parent_b_idx = TSDK_LOAD( ushort, body + 2UL );
  child_idx = TSDK_LOAD( ushort, body + 4UL );
  seed = body + (ulong)offsetof( cambrian_reproduce_args_t, seed );
  entropy = body + (ulong)offsetof( cambrian_reproduce_args_t, entropy );
  proof = body + fixed_size;

  require_condition( bytes_nonzero( seed, TN_SEED_SIZE ),
                     CAMBRIAN_ERR_INVALID_SEED );
  require_condition( parent_a_idx != parent_b_idx &&
                     parent_a_idx != child_idx && parent_b_idx != child_idx,
                     CAMBRIAN_ERR_SAME_ORGANISM );
  parent_a_address = account_address( parent_a_idx );
  parent_b_address = account_address( parent_b_idx );
  child_address = account_address( child_idx );
  require_condition( !same_pubkey( parent_a_address, parent_b_address ) &&
                     !same_pubkey( parent_a_address, child_address ) &&
                     !same_pubkey( parent_b_address, child_address ),
                     CAMBRIAN_ERR_SAME_ORGANISM );

  load_organism( parent_a_idx, &parent_a, 1 );
  load_organism( parent_b_idx, &parent_b, 0 );
  require_condition( controller_authorized( &parent_a ),
                     CAMBRIAN_ERR_UNAUTHORIZED );
  require_condition( parent_a.status != CAMBRIAN_STATUS_DEAD &&
                     parent_b.status != CAMBRIAN_STATUS_DEAD,
                     CAMBRIAN_ERR_INVALID_STATUS );
  require_condition( parent_a.energy >= CAMBRIAN_REPRODUCTION_COST,
                     CAMBRIAN_ERR_NO_ENERGY );

  create_organism_account( child_idx, seed, proof, proof_size );
  block = current_block();

  hash_begin( &sha, "CAMBRIAN/REPRODUCTION/v1",
              (ulong)(sizeof( "CAMBRIAN/REPRODUCTION/v1" ) - 1UL) );
  hash_append_state_hash( &sha, &parent_a,
                          (ulong)offsetof( cambrian_organism_t, genome ) );
  hash_append_state_hash( &sha, &parent_b,
                          (ulong)offsetof( cambrian_organism_t, genome ) );
  hash_append_state_hash( &sha, &parent_a,
                          (ulong)offsetof( cambrian_organism_t, lineage ) );
  hash_append_state_hash( &sha, &parent_b,
                          (ulong)offsetof( cambrian_organism_t, lineage ) );
  hash_append( &sha, seed, 32UL );
  hash_append( &sha, entropy, 32UL );
  hash_append( &sha, block->cur_block_hash.uc, 32UL );
  hash_append( &sha, child_address->uc, 32UL );
  hash_append_u64( &sha, tsdk_txn_get_nonce( current_txn() ) );
  hash_finish( &sha, &digest );

  memset( &child, 0, sizeof( child ) );
  child.magic = (uint)CAMBRIAN_MAGIC;
  child.version = CAMBRIAN_VERSION;
  child.status = CAMBRIAN_STATUS_ALIVE;
  generation = parent_a.generation > parent_b.generation ?
                 parent_a.generation : parent_b.generation;
  require_condition( generation != 0xFFFFU, CAMBRIAN_ERR_ARITHMETIC );
  child.generation = (ushort)( generation + 1U );
  write_state_bytes( &child,
                     (ulong)offsetof( cambrian_organism_t, controller ),
                     state_bytes( &parent_a,
                                  (ulong)offsetof( cambrian_organism_t,
                                                   controller ) ), 32UL );
  write_state_bytes( &child,
                     (ulong)offsetof( cambrian_organism_t, parent_a ),
                     parent_a_address->uc, 32UL );
  write_state_bytes( &child,
                     (ulong)offsetof( cambrian_organism_t, parent_b ),
                     parent_b_address->uc, 32UL );

  for( i = 0U; i < 32U; i++ ) {
    uchar mask = digest.uc[ i ];
    mutable_state_bytes( &child,
                         (ulong)offsetof( cambrian_organism_t, genome ) )[ i ] =
      (uchar)( (state_bytes( &parent_a,
                             (ulong)offsetof( cambrian_organism_t, genome ) )[ i ] &
                mask) |
              (state_bytes( &parent_b,
                            (ulong)offsetof( cambrian_organism_t, genome ) )[ i ] &
               (uchar)~mask) );
  }
  changed_bit = mutation_bit( &digest );
  mutable_state_bytes( &child,
                       (ulong)offsetof( cambrian_organism_t, genome ) )[
                         changed_bit / 8U ] ^= (uchar)( 1U << (changed_bit % 8U) );

  hash_begin( &sha, "CAMBRIAN/CHILD-LINEAGE/v1",
              (ulong)(sizeof( "CAMBRIAN/CHILD-LINEAGE/v1" ) - 1UL) );
  hash_append_state_hash( &sha, &parent_a,
                          (ulong)offsetof( cambrian_organism_t, lineage ) );
  hash_append_state_hash( &sha, &parent_b,
                          (ulong)offsetof( cambrian_organism_t, lineage ) );
  hash_append( &sha, state_bytes( &child,
                                  (ulong)offsetof( cambrian_organism_t, genome ) ),
               32UL );
  hash_append( &sha, child_address->uc, 32UL );
  hash_append_u64( &sha, block->slot );
  hash_finish( &sha, &digest );
  write_state_bytes( &child,
                     (ulong)offsetof( cambrian_organism_t, lineage ),
                     digest.uc, 32UL );

  hash_begin( &sha, "CAMBRIAN/CHILD-MEMORY/v1",
              (ulong)(sizeof( "CAMBRIAN/CHILD-MEMORY/v1" ) - 1UL) );
  hash_append_state_hash( &sha, &child,
                          (ulong)offsetof( cambrian_organism_t, lineage ) );
  hash_append( &sha, digest.uc, 32UL );
  hash_append_u64( &sha, block->slot );
  hash_finish( &sha, &digest );
  write_state_bytes( &child,
                     (ulong)offsetof( cambrian_organism_t, memory ),
                     digest.uc, 32UL );

  child.born_slot = block->slot;
  child.last_pulse_slot = block->slot;
  child.energy = saturating_add( 1024UL, (ulong)digest.uc[ 0 ],
                                 CAMBRIAN_MAX_ENERGY );
  child.vitality = saturating_add( CAMBRIAN_INITIAL_VITALITY,
                                   (ulong)digest.uc[ 1 ],
                                   CAMBRIAN_MAX_VITALITY );
  child.age = 0UL;
  child.pulse_count = 0UL;
  child.encounter_count = 0UL;
  child.offspring_count = 0UL;
  store_organism( child_idx, &child );

  parent_a.energy = floor_sub( parent_a.energy, CAMBRIAN_REPRODUCTION_COST );
  parent_a.offspring_count = saturating_add( parent_a.offspring_count, 1UL,
                                             ~0UL );
  hash_begin( &sha, "CAMBRIAN/PARENT-MEMORY/v1",
              (ulong)(sizeof( "CAMBRIAN/PARENT-MEMORY/v1" ) - 1UL) );
  hash_append_state_hash( &sha, &parent_a,
                          (ulong)offsetof( cambrian_organism_t, memory ) );
  hash_append( &sha, child_address->uc, 32UL );
  hash_append_state_hash( &sha, &child,
                          (ulong)offsetof( cambrian_organism_t, lineage ) );
  hash_append_u64( &sha, block->slot );
  hash_finish( &sha, &digest );
  write_state_bytes( &parent_a,
                     (ulong)offsetof( cambrian_organism_t, memory ),
                     digest.uc, 32UL );
  store_organism( parent_a_idx, &parent_a );

  memset( &event, 0, sizeof( event ) );
  event.generation = child.generation;
  event.mutation_bit = changed_bit;
  event.energy = child.energy;
  memcpy( ((uchar *)&event) +
            (ulong)offsetof( cambrian_reproduce_event_t, child ),
          child_address->uc, 32UL );
  memcpy( ((uchar *)&event) +
            (ulong)offsetof( cambrian_reproduce_event_t, parent_a ),
          parent_a_address->uc, 32UL );
  memcpy( ((uchar *)&event) +
            (ulong)offsetof( cambrian_reproduce_event_t, parent_b ),
          parent_b_address->uc, 32UL );
  memcpy( ((uchar *)&event) +
            (ulong)offsetof( cambrian_reproduce_event_t, genome ),
          state_bytes( &child,
                       (ulong)offsetof( cambrian_organism_t, genome ) ), 32UL );
  memcpy( ((uchar *)&event) +
            (ulong)offsetof( cambrian_reproduce_event_t, lineage ),
          state_bytes( &child,
                       (ulong)offsetof( cambrian_organism_t, lineage ) ), 32UL );
  emit_typed_event( CAMBRIAN_EVENT_REPRODUCE, &event, sizeof( event ) );
}

static void
handle_transfer( uchar const * body, ulong body_size ) {
  ulong expected_size = (ulong)sizeof( cambrian_transfer_args_t );
  ushort organism_idx;
  ushort new_controller_idx;
  cambrian_organism_t state;
  cambrian_transfer_event_t event;
  tn_pubkey_t old_controller;
  tn_pubkey_t const * new_controller;
  tn_pubkey_t const * organism;
  tsdk_block_ctx_t const * block;
  tsdk_sha256_t sha;
  tn_hash_t digest;

  require_condition( body_size == expected_size, CAMBRIAN_ERR_BAD_SIZE );
  organism_idx = TSDK_LOAD( ushort, body );
  new_controller_idx = TSDK_LOAD( ushort, body + 2UL );
  require_condition( new_controller_idx != 1U,
                     CAMBRIAN_ERR_BAD_ACCOUNT_INDEX );
  new_controller = account_address( new_controller_idx );
  require_condition( !same_pubkey( new_controller,
                                    tsdk_get_current_program_acc_addr() ),
                     CAMBRIAN_ERR_BAD_ACCOUNT_INDEX );

  load_organism( organism_idx, &state, 1 );
  require_condition( controller_authorized( &state ),
                     CAMBRIAN_ERR_UNAUTHORIZED );
  require_condition( state.status != CAMBRIAN_STATUS_DEAD,
                     CAMBRIAN_ERR_INVALID_STATUS );
  copy_state_bytes( old_controller.uc, &state,
                    (ulong)offsetof( cambrian_organism_t, controller ), 32UL );
  require_condition( !same_pubkey( &old_controller, new_controller ),
                     CAMBRIAN_ERR_UNAUTHORIZED );
  block = current_block();

  write_state_bytes( &state,
                     (ulong)offsetof( cambrian_organism_t, controller ),
                     new_controller->uc, 32UL );
  hash_begin( &sha, "CAMBRIAN/TRANSFER-MEMORY/v1",
              (ulong)(sizeof( "CAMBRIAN/TRANSFER-MEMORY/v1" ) - 1UL) );
  hash_append_state_hash( &sha, &state,
                          (ulong)offsetof( cambrian_organism_t, memory ) );
  hash_append( &sha, old_controller.uc, 32UL );
  hash_append( &sha, new_controller->uc, 32UL );
  hash_append_u64( &sha, block->slot );
  hash_finish( &sha, &digest );
  write_state_bytes( &state,
                     (ulong)offsetof( cambrian_organism_t, memory ),
                     digest.uc, 32UL );
  store_organism( organism_idx, &state );

  organism = account_address( organism_idx );
  memset( &event, 0, sizeof( event ) );
  event.slot = block->slot;
  memcpy( ((uchar *)&event) +
            (ulong)offsetof( cambrian_transfer_event_t, organism ),
          organism->uc, 32UL );
  memcpy( ((uchar *)&event) +
            (ulong)offsetof( cambrian_transfer_event_t, old_controller ),
          old_controller.uc, 32UL );
  memcpy( ((uchar *)&event) +
            (ulong)offsetof( cambrian_transfer_event_t, new_controller ),
          new_controller->uc, 32UL );
  emit_typed_event( CAMBRIAN_EVENT_TRANSFER, &event, sizeof( event ) );
}

TSDK_ENTRYPOINT_FN void
start( void const * instruction_data, ulong instruction_data_sz ) {
  uchar const * bytes;
  uchar instruction_tag;

  require_condition( instruction_data != NULL && instruction_data_sz >= 1UL,
                     CAMBRIAN_ERR_BAD_SIZE );
  bytes = (uchar const *)instruction_data;
  instruction_tag = bytes[ 0 ];

  switch( instruction_tag ) {
    case CAMBRIAN_INSTRUCTION_BIRTH:
      handle_birth( bytes + 1UL, instruction_data_sz - 1UL, 0 );
      break;
    case CAMBRIAN_INSTRUCTION_WALLET_BIRTH:
      handle_birth( bytes + 1UL, instruction_data_sz - 1UL, 1 );
      break;
    case CAMBRIAN_INSTRUCTION_PULSE:
      handle_pulse( bytes + 1UL, instruction_data_sz - 1UL );
      break;
    case CAMBRIAN_INSTRUCTION_ENCOUNTER:
      handle_encounter( bytes + 1UL, instruction_data_sz - 1UL );
      break;
    case CAMBRIAN_INSTRUCTION_REPRODUCE:
      handle_reproduce( bytes + 1UL, instruction_data_sz - 1UL );
      break;
    case CAMBRIAN_INSTRUCTION_TRANSFER:
      handle_transfer( bytes + 1UL, instruction_data_sz - 1UL );
      break;
    default:
      tsdk_revert( CAMBRIAN_ERR_BAD_INSTRUCTION );
  }

  tsdk_return( TSDK_SUCCESS );
}
