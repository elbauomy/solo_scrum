BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Setting] ADD [idleMinutes] INT NOT NULL CONSTRAINT [Setting_idleMinutes_df] DEFAULT 120,
[lockMinutes] INT NOT NULL CONSTRAINT [Setting_lockMinutes_df] DEFAULT 15,
[maxFailedSignIns] INT NOT NULL CONSTRAINT [Setting_maxFailedSignIns_df] DEFAULT 5,
[minPasswordLength] INT NOT NULL CONSTRAINT [Setting_minPasswordLength_df] DEFAULT 8;

-- AlterTable
ALTER TABLE [dbo].[User] ADD [failedSignIns] INT NOT NULL CONSTRAINT [User_failedSignIns_df] DEFAULT 0,
[lockedUntil] DATETIME2;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

