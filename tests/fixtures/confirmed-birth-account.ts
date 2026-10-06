// Public Betanet data from the user-approved Birth at slot 467823.
// Keep these bytes independent of frontend constants to catch contract-layout drift.
export const confirmedBirthAccount = {
  address: "tan6tJbdSRHI_fuE_-UA_toO7JA6pr6-ZFOxRZITLqxmXV",
  signature: "tsWB3zMvn0EKDwYyGsD73itkKONcby6myoUTI9M_7F2NaTiMlsKLAbV0yJtnLlyH2-KGfgdzazvqX_l90H8ObnAyPF",
  controller: "taNbZsKSCffNjdVSyyCWJuevUwJSTET1w6Ds8xzksV6Pco",
  data: new Uint8Array(Buffer.from([
    "424d414301010000", // magic, version, status, generation
    "35b66c29209f7cd8dd552cb209626e7af5302524c44f5c3a0ecf31ce4b15e8f7", // controller
    "0000000000000000000000000000000000000000000000000000000000000000", // parent A
    "0000000000000000000000000000000000000000000000000000000000000000", // parent B
    "4ddb13df3ff35792f983e4b1c468b536367c0fe33544ad9ad5ab5ff1287b7546", // genome
    "3b9dd48cbdc6aab976d97ab89cfecf0d364a27ad19df096965586235eeded682", // lineage
    "a7f64255336234ad75d2a3d016d39b1af9f0a6f4244e3fa1b1497e236d03bc1e", // memory
    "6f23070000000000", // born slot
    "6f23070000000000", // last pulse slot
    "0000000000000000", // age
    "0008000000000000", // energy
    "4d03000000000000", // vitality
    "0000000000000000", // pulse count
    "0000000000000000", // encounter count
    "0000000000000000", // offspring count
  ].join(""), "hex")),
};
