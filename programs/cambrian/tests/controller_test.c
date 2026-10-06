#include <assert.h>
#include <setjmp.h>
#include <stdio.h>
#include <string.h>

typedef unsigned short ushort;
typedef unsigned long ulong;
typedef struct { unsigned char uc[32]; } tn_pubkey_t;
#define CAMBRIAN_ERR_BAD_ACCOUNT_INDEX 0xCA010003UL
#define CAMBRIAN_ERR_ACCOUNT_MISSING 0xCA010004UL
#define CAMBRIAN_ERR_UNAUTHORIZED 0xCA01000CUL

static tn_pubkey_t addresses[6];
static int exists[6];
static int authorized[6];
static jmp_buf revert_point;
static ulong reverted_code;

static void require_condition(int condition, ulong error_code) {
  if (!condition) { reverted_code = error_code; longjmp(revert_point, 1); }
}
static tn_pubkey_t const * account_address(ushort index) {
  require_condition(index < 6, CAMBRIAN_ERR_BAD_ACCOUNT_INDEX);
  return &addresses[index];
}
static int tsdk_account_exists(ushort index) { return exists[index]; }
static int tsdk_is_account_authorized_by_pubkey(tn_pubkey_t const * key) {
  for (int i = 0; i < 6; ++i) if (memcmp(key->uc, addresses[i].uc, 32) == 0) return authorized[i];
  return 0;
}
#include "../examples/cambrian_controller.h"

static void expect_revert(ushort controller, ushort organism, int managed, ulong code) {
  reverted_code = 0;
  if (setjmp(revert_point) == 0) {
    (void)resolve_birth_controller(controller, organism, managed);
    assert(!"Unauthorized controller unexpectedly accepted");
  }
  assert(reverted_code == code);
}
int main(void) {
  for (int i = 0; i < 6; ++i) { memset(addresses[i].uc, i + 1, 32); exists[i] = 1; }
  /* The outer fee payer is valid and signed, but is never the managed controller. */
  authorized[0] = 1; authorized[2] = 1;
  assert(resolve_birth_controller(2, 3, 1) == &addresses[2]);
  assert(resolve_birth_controller(2, 3, 1) != &addresses[0]);
  expect_revert(0, 3, 1, CAMBRIAN_ERR_BAD_ACCOUNT_INDEX);
  expect_revert(1, 3, 1, CAMBRIAN_ERR_BAD_ACCOUNT_INDEX);
  expect_revert(3, 3, 1, CAMBRIAN_ERR_BAD_ACCOUNT_INDEX);
  expect_revert(4, 3, 1, CAMBRIAN_ERR_UNAUTHORIZED);
  exists[5] = 0;
  expect_revert(5, 3, 1, CAMBRIAN_ERR_ACCOUNT_MISSING);
  expect_revert(65535, 3, 1, CAMBRIAN_ERR_BAD_ACCOUNT_INDEX);
  authorized[2] = 0;
  expect_revert(2, 3, 1, CAMBRIAN_ERR_UNAUTHORIZED);
  /* Legacy tag 0 keeps its old, explicitly fee-payer-owned behavior. */
  assert(resolve_birth_controller(0, 3, 0) == &addresses[0]);
  expect_revert(2, 3, 0, CAMBRIAN_ERR_BAD_ACCOUNT_INDEX);
  authorized[0] = 0;
  expect_revert(0, 3, 0, CAMBRIAN_ERR_UNAUTHORIZED);
  puts("11 production C controller authorization checks passed.");
  return 0;
}
