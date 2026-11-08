BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[User] (
    [id] NVARCHAR(36) NOT NULL,
    [username] NVARCHAR(100) NOT NULL,
    [displayName] NVARCHAR(200) NOT NULL,
    [email] NVARCHAR(200),
    [passwordHash] NVARCHAR(200),
    [mustChangePassword] BIT NOT NULL CONSTRAINT [User_mustChangePassword_df] DEFAULT 0,
    [active] BIT NOT NULL CONSTRAINT [User_active_df] DEFAULT 1,
    [roleId] NVARCHAR(36) NOT NULL,
    [memberId] NVARCHAR(36),
    [sessionVersion] INT NOT NULL CONSTRAINT [User_sessionVersion_df] DEFAULT 1,
    [lastLoginAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [User_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [User_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [User_username_key] UNIQUE NONCLUSTERED ([username])
);

-- CreateTable
CREATE TABLE [dbo].[Role] (
    [id] NVARCHAR(36) NOT NULL,
    [name] NVARCHAR(60) NOT NULL,
    [description] NVARCHAR(300) NOT NULL CONSTRAINT [Role_description_df] DEFAULT '',
    [builtIn] BIT NOT NULL CONSTRAINT [Role_builtIn_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Role_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Role_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Role_name_key] UNIQUE NONCLUSTERED ([name])
);

-- CreateTable
CREATE TABLE [dbo].[RolePermission] (
    [id] NVARCHAR(36) NOT NULL,
    [roleId] NVARCHAR(36) NOT NULL,
    [permission] NVARCHAR(50) NOT NULL,
    CONSTRAINT [RolePermission_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [RolePermission_roleId_permission_key] UNIQUE NONCLUSTERED ([roleId],[permission])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [User_roleId_idx] ON [dbo].[User]([roleId]);

-- Email and member link are optional but unique when set. SQL Server allows only one NULL in a plain unique index,
-- so these are filtered unique indexes (written by hand; see docs/SQL_SERVER.md).
CREATE UNIQUE NONCLUSTERED INDEX [User_email_key] ON [dbo].[User]([email]) WHERE [email] IS NOT NULL;
CREATE UNIQUE NONCLUSTERED INDEX [User_memberId_key] ON [dbo].[User]([memberId]) WHERE [memberId] IS NOT NULL;

-- AddForeignKey
ALTER TABLE [dbo].[User] ADD CONSTRAINT [User_roleId_fkey] FOREIGN KEY ([roleId]) REFERENCES [dbo].[Role]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[User] ADD CONSTRAINT [User_memberId_fkey] FOREIGN KEY ([memberId]) REFERENCES [dbo].[Member]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[RolePermission] ADD CONSTRAINT [RolePermission_roleId_fkey] FOREIGN KEY ([roleId]) REFERENCES [dbo].[Role]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

