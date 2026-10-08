// Public Betanet organism bytes from the user-approved wallet Birth at slot 622115.
// This is separate from the legacy fee-payer-owned Birth fixture; no wallet auth data.
export const confirmedWalletBirthAccount = {
  address: "taY8nbo7JNiofdeY4zEfcQSDaRxXl7qrePlS-K6L4xvKos",
  signature: "tsuzn2fgPzjRUsAW7lWCSC6xzGjFZXToXszUeHVmw2t8pcXLiDHthZjpTo-eB8wX2JhF2PGld42YSmTskDpJN5Ah_n",
  controller: "taPGuB7kndMDyU0aM1X8Wr-LDpFY-hsA3R119RgVLlU6VP",
  feePayer: "taNbZsKSCffNjdVSyyCWJuevUwJSTET1w6Ds8xzksV6Pco",
  data: new Uint8Array(Buffer.from([
    "424d414301010000", // magic, version, status, generation
    "3c6b81ee49dd303c94d1a3355fc5abf8b0e9158fa1b00dd1d75f518152e553a5", // managed controller
    "0000000000000000000000000000000000000000000000000000000000000000", // parent A
    "0000000000000000000000000000000000000000000000000000000000000000", // parent B
    "cfcf84451de717181261a15de930f6045aa9dc6914d96a7c556e987db8c2f25e", // genome
    "8d756a917ddf6c35f679277f6a60ea901aab84b1e4b669bf16a3b62a70fc2883", // lineage
    "a3724b7733334244f41eff68f453d4c44ea6417b52dd64f53bc519dfc41fa597", // memory
    "237e090000000000", // born slot
    "237e090000000000", // last pulse slot
    "0000000000000000", // age
    "0008000000000000", // energy
    "cf03000000000000", // vitality
    "0000000000000000", // pulse count
    "0000000000000000", // encounter count
    "0000000000000000", // offspring count
  ].join(""), "hex")),
};
