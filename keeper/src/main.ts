import { DEPLOYMENT_4663 } from '@sleeve/core';

// Scaffold entry so build and start work end to end. The keeper replaces it.
console.error(
  JSON.stringify({
    level: 'fatal',
    msg: 'keeper not implemented',
    chainId: DEPLOYMENT_4663.chainId,
    module: DEPLOYMENT_4663.contracts.SleeveModule.address,
  }),
);
process.exitCode = 1;
