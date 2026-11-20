// OS process creation observation double, only for production-adapter unit tests.
export const processIdentity={version:1,platform:process.platform,host:'offline-double',pid:12345,startId:'123456789'};
export const processObservations={probe:async()=>({state:'running',identity:processIdentity})};
export const requestBinding={requestId:'unit-test',requestFingerprint:'f'.repeat(64)};
