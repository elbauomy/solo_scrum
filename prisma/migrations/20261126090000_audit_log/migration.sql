BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[WorkItemHistory] ADD [changedById] NVARCHAR(36);

-- CreateTable
CREATE TABLE [dbo].[AuditLog] (
    [id] NVARCHAR(36) NOT NULL,
    [at] DATETIME2 NOT NULL CONSTRAINT [AuditLog_at_df] DEFAULT CURRENT_TIMESTAMP,
    [userId] NVARCHAR(36),
    [userName] NVARCHAR(200),
    [typedUsername] NVARCHAR(100),
    [action] NVARCHAR(50) NOT NULL,
    [recordType] NVARCHAR(50),
    [recordId] NVARCHAR(100),
    [recordName] NVARCHAR(300),
    [details] NVARCHAR(max),
    [ip] NVARCHAR(100),
    CONSTRAINT [AuditLog_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditLog_at_idx] ON [dbo].[AuditLog]([at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditLog_userId_at_idx] ON [dbo].[AuditLog]([userId], [at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditLog_action_at_idx] ON [dbo].[AuditLog]([action], [at]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

