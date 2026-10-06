#ifndef CAMBRIAN_PROGRAM_H
#define CAMBRIAN_PROGRAM_H

#include <stddef.h>

#include <thru-sdk/c/tn_sdk.h>
#include <thru-sdk/c/tn_sdk_sha256.h>
#include <thru-sdk/c/tn_sdk_syscall.h>

/* Cambrian is intentionally a small, account-local state machine. */
#define CAMBRIAN_MAGIC (0x43414D42UL) /* "CAMB" */
#define CAMBRIAN_VERSION ((uchar)1U)

#define CAMBRIAN_STATUS_ALIVE ((uchar)1U)
#define CAMBRIAN_STATUS_DORMANT ((uchar)2U)
#define CAMBRIAN_STATUS_DEAD ((uchar)3U)

#define CAMBRIAN_EVENT_BIRTH ((uchar)0U)
#define CAMBRIAN_EVENT_PULSE ((uchar)1U)
#define CAMBRIAN_EVENT_ENCOUNTER ((uchar)2U)
#define CAMBRIAN_EVENT_REPRODUCE ((uchar)3U)
#define CAMBRIAN_EVENT_TRANSFER ((uchar)4U)

#define CAMBRIAN_INSTRUCTION_BIRTH ((uchar)0U)
#define CAMBRIAN_INSTRUCTION_PULSE ((uchar)1U)
#define CAMBRIAN_INSTRUCTION_ENCOUNTER ((uchar)2U)
#define CAMBRIAN_INSTRUCTION_REPRODUCE ((uchar)3U)
#define CAMBRIAN_INSTRUCTION_TRANSFER ((uchar)4U)
#define CAMBRIAN_INSTRUCTION_WALLET_BIRTH ((uchar)5U)

#define CAMBRIAN_MAX_PROOF_SIZE (16384UL)
#define CAMBRIAN_MAX_PULSE_ELAPSED (4096UL)
#define CAMBRIAN_INITIAL_ENERGY (2048UL)
#define CAMBRIAN_INITIAL_VITALITY (768UL)
#define CAMBRIAN_MAX_ENERGY (65535UL)
#define CAMBRIAN_MAX_VITALITY (1024UL)
#define CAMBRIAN_REPRODUCTION_COST (512UL)
#define CAMBRIAN_NO_MUTATION ((ushort)0xFFFFU)

/* Stable program error codes. Keep these values ABI-compatible forever. */
#define CAMBRIAN_ERR_BAD_INSTRUCTION (0xCA010001UL)
#define CAMBRIAN_ERR_BAD_SIZE (0xCA010002UL)
#define CAMBRIAN_ERR_BAD_ACCOUNT_INDEX (0xCA010003UL)
#define CAMBRIAN_ERR_ACCOUNT_MISSING (0xCA010004UL)
#define CAMBRIAN_ERR_ACCOUNT_EXISTS (0xCA010005UL)
#define CAMBRIAN_ERR_ACCOUNT_NOT_WRITABLE (0xCA010006UL)
#define CAMBRIAN_ERR_ACCOUNT_CREATE (0xCA010007UL)
#define CAMBRIAN_ERR_ACCOUNT_RESIZE (0xCA010008UL)
#define CAMBRIAN_ERR_ACCOUNT_DATA (0xCA010009UL)
#define CAMBRIAN_ERR_ACCOUNT_LAYOUT (0xCA01000AUL)
#define CAMBRIAN_ERR_ACCOUNT_OWNER (0xCA01000BUL)
#define CAMBRIAN_ERR_UNAUTHORIZED (0xCA01000CUL)
#define CAMBRIAN_ERR_INVALID_STATUS (0xCA01000DUL)
#define CAMBRIAN_ERR_INVALID_SEED (0xCA01000EUL)
#define CAMBRIAN_ERR_INVALID_PROOF (0xCA01000FUL)
#define CAMBRIAN_ERR_CLOCK (0xCA010010UL)
#define CAMBRIAN_ERR_NO_ENERGY (0xCA010011UL)
#define CAMBRIAN_ERR_SAME_ORGANISM (0xCA010012UL)
#define CAMBRIAN_ERR_EVENT (0xCA010013UL)
#define CAMBRIAN_ERR_ARITHMETIC (0xCA010014UL)
#define CAMBRIAN_ERR_ADDRESS (0xCA010015UL)

/* Persistent account state. The packed layout is 264 bytes. */
typedef struct __attribute__((packed)) {
  uint magic;
  uchar version;
  uchar status;
  ushort generation;
  tn_pubkey_t controller;
  tn_pubkey_t parent_a;
  tn_pubkey_t parent_b;
  tn_hash_t genome;
  tn_hash_t lineage;
  tn_hash_t memory;
  ulong born_slot;
  ulong last_pulse_slot;
  ulong age;
  ulong energy;
  ulong vitality;
  ulong pulse_count;
  ulong encounter_count;
  ulong offspring_count;
} cambrian_organism_t;

_Static_assert(sizeof(cambrian_organism_t) == 264UL,
               "Cambrian organism layout must remain 264 bytes");

/* Instruction payloads. The proof bytes follow the fixed prefix in the wire data. */
typedef struct __attribute__((packed)) {
  ushort organism_account_idx;
  uchar seed[TN_SEED_SIZE];
  uchar entropy[32];
  uint proof_size;
} cambrian_birth_args_t;

/* New tag: explicit, runtime-authorized managed wallet. Legacy tag 0 is unchanged. */
typedef struct __attribute__((packed)) {
  ushort organism_account_idx;
  ushort controller_account_idx;
  uchar seed[TN_SEED_SIZE];
  uchar entropy[32];
  uint proof_size;
} cambrian_wallet_birth_args_t;

typedef struct __attribute__((packed)) {
  ushort organism_account_idx;
  ulong catalyst;
} cambrian_pulse_args_t;

typedef struct __attribute__((packed)) {
  ushort actor_account_idx;
  ushort donor_account_idx;
  ulong catalyst;
} cambrian_encounter_args_t;

typedef struct __attribute__((packed)) {
  ushort parent_a_account_idx;
  ushort parent_b_account_idx;
  ushort child_account_idx;
  uchar seed[TN_SEED_SIZE];
  uchar entropy[32];
  uint proof_size;
} cambrian_reproduce_args_t;

typedef struct __attribute__((packed)) {
  ushort organism_account_idx;
  ushort new_controller_account_idx;
} cambrian_transfer_args_t;

/* Explorer-facing event payloads. The root event tag is emitted immediately
   before one of these payloads. */
typedef struct __attribute__((packed)) {
  tn_pubkey_t organism;
  tn_pubkey_t controller;
  ulong slot;
  ushort generation;
  ulong energy;
  ulong vitality;
  tn_hash_t genome;
  tn_hash_t lineage;
} cambrian_birth_event_t;

typedef struct __attribute__((packed)) {
  tn_pubkey_t organism;
  ulong slot;
  ulong age;
  ulong energy_before;
  ulong energy_after;
  ulong vitality;
  uchar status;
  ushort mutation_bit;
  tn_hash_t genome;
  tn_hash_t lineage;
} cambrian_pulse_event_t;

typedef struct __attribute__((packed)) {
  tn_pubkey_t actor;
  tn_pubkey_t donor;
  ushort compatibility;
  uchar outcome;
  uchar gene_transferred;
  ulong energy_before;
  ulong energy_after;
  ulong encounter_count;
  tn_hash_t genome;
  tn_hash_t memory;
} cambrian_encounter_event_t;

typedef struct __attribute__((packed)) {
  tn_pubkey_t child;
  tn_pubkey_t parent_a;
  tn_pubkey_t parent_b;
  ushort generation;
  ushort mutation_bit;
  ulong energy;
  tn_hash_t genome;
  tn_hash_t lineage;
} cambrian_reproduce_event_t;

typedef struct __attribute__((packed)) {
  tn_pubkey_t organism;
  tn_pubkey_t old_controller;
  tn_pubkey_t new_controller;
  ulong slot;
} cambrian_transfer_event_t;

typedef struct __attribute__((packed)) {
  ulong code;
} cambrian_error_t;

_Static_assert(sizeof(cambrian_birth_args_t) == 70UL,
               "BirthArgs fixed prefix must remain 70 bytes");
_Static_assert(sizeof(cambrian_wallet_birth_args_t) == 72UL,
               "WalletBirthArgs fixed prefix must remain 72 bytes");
_Static_assert(sizeof(cambrian_pulse_args_t) == 10UL,
               "PulseArgs must remain 10 bytes");
_Static_assert(sizeof(cambrian_encounter_args_t) == 12UL,
               "EncounterArgs must remain 12 bytes");
_Static_assert(sizeof(cambrian_reproduce_args_t) == 74UL,
               "ReproduceArgs fixed prefix must remain 74 bytes");
_Static_assert(sizeof(cambrian_transfer_args_t) == 4UL,
               "TransferArgs must remain 4 bytes");
_Static_assert(sizeof(cambrian_birth_event_t) == 154UL,
               "BirthEvent must remain 154 bytes");
_Static_assert(sizeof(cambrian_pulse_event_t) == 139UL,
               "PulseEvent must remain 139 bytes");
_Static_assert(sizeof(cambrian_encounter_event_t) == 156UL,
               "EncounterEvent must remain 156 bytes");
_Static_assert(sizeof(cambrian_reproduce_event_t) == 172UL,
               "ReproduceEvent must remain 172 bytes");
_Static_assert(sizeof(cambrian_transfer_event_t) == 104UL,
               "TransferEvent must remain 104 bytes");
_Static_assert(sizeof(cambrian_error_t) == 8UL,
               "CambrianError must remain 8 bytes");

#endif /* CAMBRIAN_PROGRAM_H */
