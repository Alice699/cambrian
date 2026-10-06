#ifndef CAMBRIAN_CONTROLLER_H
#define CAMBRIAN_CONTROLLER_H

/* Kept separate so the exact production authorization boundary can be exercised
   by the offline C harness with mocked runtime authorization, not a JS model. */
static tn_pubkey_t const *
resolve_birth_controller( ushort controller_idx, ushort organism_idx, int wallet_owned ) {
  tn_pubkey_t const * controller;
  if( wallet_owned ) {
    require_condition( controller_idx >= 2U && controller_idx != organism_idx,
                       CAMBRIAN_ERR_BAD_ACCOUNT_INDEX );
  } else {
    require_condition( controller_idx == 0U, CAMBRIAN_ERR_BAD_ACCOUNT_INDEX );
  }
  controller = account_address( controller_idx );
  require_condition( tsdk_account_exists( controller_idx ), CAMBRIAN_ERR_ACCOUNT_MISSING );
  require_condition( tsdk_is_account_authorized_by_pubkey( controller ), CAMBRIAN_ERR_UNAUTHORIZED );
  return controller;
}

#endif
