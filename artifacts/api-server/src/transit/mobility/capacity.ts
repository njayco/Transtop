export const smallCapacity={compressed:20*1024**2,expanded:100*1024**2,rows:1_000_000,shapePoints:1_000_000};
// Manual regional imports only. Measured with the isolated storage benchmark
// and Berlin-Brandenburg archive; automatic discovery retains its small budget.
export const regionalCapacity={compressed:96*1024**2,expanded:768*1024**2,rows:8_000_000,shapePoints:7_000_000};
export const referenceCapacity={stops:60_000,trips:350_000,routes:3000,memberships:500_000,bytes:128*1024**2};
