import { test } from "node:test";
import assert from "node:assert/strict";
import { proximoSlotDiario, publishHoraCR } from "@/lib/marketplace/tasks";

test("proximoSlotDiario: una por día a las 7am CR", () => {
  const ult = new Date("2026-10-10T15:10:00Z"); // 9:10 CR del 10
  // 11-oct 6:30 CR (12:30Z): todavía no → próximo 11-oct 7:00 CR = 13:00Z
  assert.equal(proximoSlotDiario(ult, 7, new Date("2026-10-11T12:30:00Z"))?.toISOString(), "2026-10-11T13:00:00.000Z");
  // 11-oct 7:05 CR: ya toca
  assert.equal(proximoSlotDiario(ult, 7, new Date("2026-10-11T13:05:00Z")), null);
  // publicó 11-oct 7:10 CR → a las 8 CR no toca; próximo 12-oct 7 CR
  const hoy = new Date("2026-10-11T13:10:00Z");
  assert.equal(proximoSlotDiario(hoy, 7, new Date("2026-10-11T14:00:00Z"))?.toISOString(), "2026-10-12T13:00:00.000Z");
  // a las 23:30 CR (05:30Z del 12) tampoco
  assert.equal(proximoSlotDiario(hoy, 7, new Date("2026-10-12T05:30:00Z"))?.toISOString(), "2026-10-12T13:00:00.000Z");
  assert.equal(proximoSlotDiario(null, 7, new Date("2026-10-12T05:30:00Z")), null);
  assert.equal(publishHoraCR({ ROBOT_PUBLISH_HORA_CR: "7" } as unknown as NodeJS.ProcessEnv), 7);
  assert.equal(publishHoraCR({} as unknown as NodeJS.ProcessEnv), null);
});
