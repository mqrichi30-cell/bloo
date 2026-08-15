-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AppConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "tipoCambioUsdCent" INTEGER NOT NULL DEFAULT 51000,
    "tipoCambioFuente" TEXT NOT NULL DEFAULT 'manual',
    "tipoCambioActualizado" DATETIME,
    "ivaActivo" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_AppConfig" ("id", "ivaActivo", "tipoCambioUsdCent", "updatedAt") SELECT "id", "ivaActivo", "tipoCambioUsdCent", "updatedAt" FROM "AppConfig";
DROP TABLE "AppConfig";
ALTER TABLE "new_AppConfig" RENAME TO "AppConfig";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
