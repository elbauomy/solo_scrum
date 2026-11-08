BEGIN TRY

BEGIN TRAN;

-- CreateSchema
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = N'dbo') EXEC sp_executesql N'CREATE SCHEMA [dbo];';

-- CreateTable
CREATE TABLE [dbo].[Setting] (
    [id] INT NOT NULL CONSTRAINT [Setting_id_df] DEFAULT 1,
    [workingDays] NVARCHAR(20) NOT NULL CONSTRAINT [Setting_workingDays_df] DEFAULT '1,2,3,4,5',
    [defaultDailyHours] FLOAT(53) NOT NULL CONSTRAINT [Setting_defaultDailyHours_df] DEFAULT 8,
    [defaultSprintLengthDays] INT NOT NULL CONSTRAINT [Setting_defaultSprintLengthDays_df] DEFAULT 14,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Setting_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Holiday] (
    [id] NVARCHAR(36) NOT NULL,
    [date] DATE NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Holiday_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Holiday_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Holiday_date_key] UNIQUE NONCLUSTERED ([date])
);

-- CreateTable
CREATE TABLE [dbo].[Squad] (
    [id] NVARCHAR(36) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(max) NOT NULL CONSTRAINT [Squad_description_df] DEFAULT '',
    [sprintLengthDays] INT,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Squad_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Squad_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Squad_name_key] UNIQUE NONCLUSTERED ([name])
);

-- CreateTable
CREATE TABLE [dbo].[LineOfBusiness] (
    [id] NVARCHAR(36) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(max) NOT NULL CONSTRAINT [LineOfBusiness_description_df] DEFAULT '',
    [squadId] NVARCHAR(36) NOT NULL,
    [sprintLengthDays] INT,
    [code] NVARCHAR(20) NOT NULL,
    [nextItemNumber] INT NOT NULL CONSTRAINT [LineOfBusiness_nextItemNumber_df] DEFAULT 1,
    [adoProject] NVARCHAR(200),
    [adoLastSyncAt] DATETIME2,
    [adoLastResult] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [LineOfBusiness_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [LineOfBusiness_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [LineOfBusiness_name_key] UNIQUE NONCLUSTERED ([name]),
    CONSTRAINT [LineOfBusiness_code_key] UNIQUE NONCLUSTERED ([code])
);

-- CreateTable
CREATE TABLE [dbo].[Member] (
    [id] NVARCHAR(36) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [role] NVARCHAR(1000) NOT NULL CONSTRAINT [Member_role_df] DEFAULT '',
    [active] BIT NOT NULL CONSTRAINT [Member_active_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Member_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Member_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[SquadMembership] (
    [id] NVARCHAR(36) NOT NULL,
    [memberId] NVARCHAR(36) NOT NULL,
    [squadId] NVARCHAR(36) NOT NULL,
    [weeklyHours] FLOAT(53) NOT NULL,
    CONSTRAINT [SquadMembership_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [SquadMembership_memberId_squadId_key] UNIQUE NONCLUSTERED ([memberId],[squadId])
);

-- CreateTable
CREATE TABLE [dbo].[Leave] (
    [id] NVARCHAR(36) NOT NULL,
    [memberId] NVARCHAR(36) NOT NULL,
    [startDate] DATE NOT NULL,
    [endDate] DATE NOT NULL,
    [note] NVARCHAR(max) NOT NULL CONSTRAINT [Leave_note_df] DEFAULT '',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Leave_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Leave_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[WorkItem] (
    [id] NVARCHAR(36) NOT NULL,
    [type] NVARCHAR(20) NOT NULL,
    [number] INT NOT NULL,
    [title] NVARCHAR(1000) NOT NULL,
    [description] NVARCHAR(max) NOT NULL CONSTRAINT [WorkItem_description_df] DEFAULT '',
    [acceptanceCriteria] NVARCHAR(max) NOT NULL CONSTRAINT [WorkItem_acceptanceCriteria_df] DEFAULT '',
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [WorkItem_status_df] DEFAULT 'NEW',
    [priority] NVARCHAR(10) NOT NULL CONSTRAINT [WorkItem_priority_df] DEFAULT 'MEDIUM',
    [rank] FLOAT(53) NOT NULL CONSTRAINT [WorkItem_rank_df] DEFAULT 0,
    [lobId] NVARCHAR(36) NOT NULL,
    [parentId] NVARCHAR(36),
    [assigneeId] NVARCHAR(36),
    [estimateHours] FLOAT(53),
    [blocked] BIT NOT NULL CONSTRAINT [WorkItem_blocked_df] DEFAULT 0,
    [blockedReason] NVARCHAR(max) NOT NULL CONSTRAINT [WorkItem_blockedReason_df] DEFAULT '',
    [doneAt] DATETIME2,
    [sprintId] NVARCHAR(36),
    [adoId] INT,
    [adoSnapshot] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [WorkItem_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [WorkItem_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [WorkItem_lobId_number_key] UNIQUE NONCLUSTERED ([lobId],[number])
);

-- CreateTable
CREATE TABLE [dbo].[WorkItemHistory] (
    [id] NVARCHAR(36) NOT NULL,
    [workItemId] NVARCHAR(36) NOT NULL,
    [field] NVARCHAR(50) NOT NULL,
    [oldValue] NVARCHAR(max),
    [newValue] NVARCHAR(max),
    [changedAt] DATETIME2 NOT NULL CONSTRAINT [WorkItemHistory_changedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [WorkItemHistory_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Sprint] (
    [id] NVARCHAR(36) NOT NULL,
    [lobId] NVARCHAR(36) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [goal] NVARCHAR(max) NOT NULL CONSTRAINT [Sprint_goal_df] DEFAULT '',
    [startDate] DATE NOT NULL,
    [endDate] DATE NOT NULL,
    [state] NVARCHAR(10) NOT NULL CONSTRAINT [Sprint_state_df] DEFAULT 'PLANNED',
    [adoPath] NVARCHAR(400),
    [releaseId] NVARCHAR(36),
    [startedAt] DATETIME2,
    [closedAt] DATETIME2,
    [result] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Sprint_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Sprint_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[SprintMemberShare] (
    [id] NVARCHAR(36) NOT NULL,
    [sprintId] NVARCHAR(36) NOT NULL,
    [memberId] NVARCHAR(36) NOT NULL,
    [sharePercent] FLOAT(53) NOT NULL,
    CONSTRAINT [SprintMemberShare_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [SprintMemberShare_sprintId_memberId_key] UNIQUE NONCLUSTERED ([sprintId],[memberId])
);

-- CreateTable
CREATE TABLE [dbo].[SprintCommitment] (
    [id] NVARCHAR(36) NOT NULL,
    [sprintId] NVARCHAR(36) NOT NULL,
    [workItemId] NVARCHAR(36) NOT NULL,
    [hours] FLOAT(53) NOT NULL CONSTRAINT [SprintCommitment_hours_df] DEFAULT 0,
    [carriedOver] BIT NOT NULL CONSTRAINT [SprintCommitment_carriedOver_df] DEFAULT 0,
    CONSTRAINT [SprintCommitment_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [SprintCommitment_sprintId_workItemId_key] UNIQUE NONCLUSTERED ([sprintId],[workItemId])
);

-- CreateTable
CREATE TABLE [dbo].[Release] (
    [id] NVARCHAR(36) NOT NULL,
    [lobId] NVARCHAR(36) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [version] NVARCHAR(1000) NOT NULL CONSTRAINT [Release_version_df] DEFAULT '',
    [notes] NVARCHAR(max) NOT NULL CONSTRAINT [Release_notes_df] DEFAULT '',
    [targetDate] DATE NOT NULL,
    [deployedDate] DATE,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Release_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Release_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ReleaseDateChange] (
    [id] NVARCHAR(36) NOT NULL,
    [releaseId] NVARCHAR(36) NOT NULL,
    [oldDate] DATE NOT NULL,
    [newDate] DATE NOT NULL,
    [reason] NVARCHAR(max) NOT NULL CONSTRAINT [ReleaseDateChange_reason_df] DEFAULT '',
    [changedAt] DATETIME2 NOT NULL CONSTRAINT [ReleaseDateChange_changedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ReleaseDateChange_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[TaskBaseline] (
    [id] NVARCHAR(36) NOT NULL,
    [workItemId] NVARCHAR(36) NOT NULL,
    [baselineStart] DATE NOT NULL,
    [baselineEnd] DATE NOT NULL,
    [acceptedAt] DATETIME2 NOT NULL CONSTRAINT [TaskBaseline_acceptedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [TaskBaseline_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [TaskBaseline_workItemId_key] UNIQUE NONCLUSTERED ([workItemId])
);

-- CreateTable
CREATE TABLE [dbo].[StandupEntry] (
    [id] NVARCHAR(36) NOT NULL,
    [date] DATE NOT NULL,
    [squadId] NVARCHAR(36) NOT NULL,
    [memberId] NVARCHAR(36) NOT NULL,
    [status] NVARCHAR(max) NOT NULL CONSTRAINT [StandupEntry_status_df] DEFAULT '',
    [isOff] BIT NOT NULL CONSTRAINT [StandupEntry_isOff_df] DEFAULT 0,
    [offReason] NVARCHAR(max) NOT NULL CONSTRAINT [StandupEntry_offReason_df] DEFAULT '',
    [yesterday] NVARCHAR(max) NOT NULL CONSTRAINT [StandupEntry_yesterday_df] DEFAULT '',
    [today] NVARCHAR(max) NOT NULL CONSTRAINT [StandupEntry_today_df] DEFAULT '',
    [blockers] NVARCHAR(max) NOT NULL CONSTRAINT [StandupEntry_blockers_df] DEFAULT '',
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [StandupEntry_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [StandupEntry_date_squadId_memberId_key] UNIQUE NONCLUSTERED ([date],[squadId],[memberId])
);

-- CreateTable
CREATE TABLE [dbo].[MemberLobAllocation] (
    [id] NVARCHAR(36) NOT NULL,
    [membershipId] NVARCHAR(36) NOT NULL,
    [lobId] NVARCHAR(36) NOT NULL,
    [weeklyHours] FLOAT(53) NOT NULL,
    CONSTRAINT [MemberLobAllocation_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [MemberLobAllocation_membershipId_lobId_key] UNIQUE NONCLUSTERED ([membershipId],[lobId])
);

-- CreateTable
CREATE TABLE [dbo].[SprintMemberPlan] (
    [id] NVARCHAR(36) NOT NULL,
    [sprintId] NVARCHAR(36) NOT NULL,
    [memberId] NVARCHAR(36) NOT NULL,
    [availabilityPct] FLOAT(53) NOT NULL CONSTRAINT [SprintMemberPlan_availabilityPct_df] DEFAULT 100,
    [initialHours] FLOAT(53) NOT NULL,
    [meetingsHours] FLOAT(53) NOT NULL CONSTRAINT [SprintMemberPlan_meetingsHours_df] DEFAULT 0,
    [vacationHours] FLOAT(53) NOT NULL CONSTRAINT [SprintMemberPlan_vacationHours_df] DEFAULT 0,
    [excuseHours] FLOAT(53) NOT NULL CONSTRAINT [SprintMemberPlan_excuseHours_df] DEFAULT 0,
    [otherHours] FLOAT(53) NOT NULL CONSTRAINT [SprintMemberPlan_otherHours_df] DEFAULT 0,
    [capacityHours] FLOAT(53) NOT NULL,
    CONSTRAINT [SprintMemberPlan_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [SprintMemberPlan_sprintId_memberId_key] UNIQUE NONCLUSTERED ([sprintId],[memberId])
);

-- CreateTable
CREATE TABLE [dbo].[SprintPause] (
    [id] NVARCHAR(36) NOT NULL,
    [sprintId] NVARCHAR(36) NOT NULL,
    [startDate] DATE NOT NULL,
    [resumedOn] DATE,
    [reason] NVARCHAR(max) NOT NULL CONSTRAINT [SprintPause_reason_df] DEFAULT '',
    [extendedByDays] INT NOT NULL CONSTRAINT [SprintPause_extendedByDays_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [SprintPause_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [SprintPause_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [LineOfBusiness_squadId_idx] ON [dbo].[LineOfBusiness]([squadId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SquadMembership_squadId_idx] ON [dbo].[SquadMembership]([squadId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Leave_memberId_idx] ON [dbo].[Leave]([memberId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [WorkItem_lobId_adoId_idx] ON [dbo].[WorkItem]([lobId], [adoId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [WorkItem_parentId_idx] ON [dbo].[WorkItem]([parentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [WorkItem_assigneeId_idx] ON [dbo].[WorkItem]([assigneeId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [WorkItem_lobId_type_idx] ON [dbo].[WorkItem]([lobId], [type]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [WorkItem_sprintId_idx] ON [dbo].[WorkItem]([sprintId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [WorkItemHistory_workItemId_changedAt_idx] ON [dbo].[WorkItemHistory]([workItemId], [changedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [WorkItemHistory_field_changedAt_idx] ON [dbo].[WorkItemHistory]([field], [changedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Sprint_lobId_startDate_idx] ON [dbo].[Sprint]([lobId], [startDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Sprint_releaseId_idx] ON [dbo].[Sprint]([releaseId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Release_lobId_targetDate_idx] ON [dbo].[Release]([lobId], [targetDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ReleaseDateChange_releaseId_changedAt_idx] ON [dbo].[ReleaseDateChange]([releaseId], [changedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [StandupEntry_squadId_date_idx] ON [dbo].[StandupEntry]([squadId], [date]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MemberLobAllocation_lobId_idx] ON [dbo].[MemberLobAllocation]([lobId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SprintMemberPlan_memberId_idx] ON [dbo].[SprintMemberPlan]([memberId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SprintPause_sprintId_startDate_idx] ON [dbo].[SprintPause]([sprintId], [startDate]);

-- AddForeignKey
ALTER TABLE [dbo].[LineOfBusiness] ADD CONSTRAINT [LineOfBusiness_squadId_fkey] FOREIGN KEY ([squadId]) REFERENCES [dbo].[Squad]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SquadMembership] ADD CONSTRAINT [SquadMembership_memberId_fkey] FOREIGN KEY ([memberId]) REFERENCES [dbo].[Member]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SquadMembership] ADD CONSTRAINT [SquadMembership_squadId_fkey] FOREIGN KEY ([squadId]) REFERENCES [dbo].[Squad]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Leave] ADD CONSTRAINT [Leave_memberId_fkey] FOREIGN KEY ([memberId]) REFERENCES [dbo].[Member]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[WorkItem] ADD CONSTRAINT [WorkItem_lobId_fkey] FOREIGN KEY ([lobId]) REFERENCES [dbo].[LineOfBusiness]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[WorkItem] ADD CONSTRAINT [WorkItem_parentId_fkey] FOREIGN KEY ([parentId]) REFERENCES [dbo].[WorkItem]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[WorkItem] ADD CONSTRAINT [WorkItem_assigneeId_fkey] FOREIGN KEY ([assigneeId]) REFERENCES [dbo].[Member]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[WorkItem] ADD CONSTRAINT [WorkItem_sprintId_fkey] FOREIGN KEY ([sprintId]) REFERENCES [dbo].[Sprint]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[WorkItemHistory] ADD CONSTRAINT [WorkItemHistory_workItemId_fkey] FOREIGN KEY ([workItemId]) REFERENCES [dbo].[WorkItem]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Sprint] ADD CONSTRAINT [Sprint_lobId_fkey] FOREIGN KEY ([lobId]) REFERENCES [dbo].[LineOfBusiness]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Sprint] ADD CONSTRAINT [Sprint_releaseId_fkey] FOREIGN KEY ([releaseId]) REFERENCES [dbo].[Release]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SprintMemberShare] ADD CONSTRAINT [SprintMemberShare_sprintId_fkey] FOREIGN KEY ([sprintId]) REFERENCES [dbo].[Sprint]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SprintMemberShare] ADD CONSTRAINT [SprintMemberShare_memberId_fkey] FOREIGN KEY ([memberId]) REFERENCES [dbo].[Member]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SprintCommitment] ADD CONSTRAINT [SprintCommitment_sprintId_fkey] FOREIGN KEY ([sprintId]) REFERENCES [dbo].[Sprint]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SprintCommitment] ADD CONSTRAINT [SprintCommitment_workItemId_fkey] FOREIGN KEY ([workItemId]) REFERENCES [dbo].[WorkItem]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Release] ADD CONSTRAINT [Release_lobId_fkey] FOREIGN KEY ([lobId]) REFERENCES [dbo].[LineOfBusiness]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ReleaseDateChange] ADD CONSTRAINT [ReleaseDateChange_releaseId_fkey] FOREIGN KEY ([releaseId]) REFERENCES [dbo].[Release]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[TaskBaseline] ADD CONSTRAINT [TaskBaseline_workItemId_fkey] FOREIGN KEY ([workItemId]) REFERENCES [dbo].[WorkItem]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[StandupEntry] ADD CONSTRAINT [StandupEntry_squadId_fkey] FOREIGN KEY ([squadId]) REFERENCES [dbo].[Squad]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[StandupEntry] ADD CONSTRAINT [StandupEntry_memberId_fkey] FOREIGN KEY ([memberId]) REFERENCES [dbo].[Member]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MemberLobAllocation] ADD CONSTRAINT [MemberLobAllocation_membershipId_fkey] FOREIGN KEY ([membershipId]) REFERENCES [dbo].[SquadMembership]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MemberLobAllocation] ADD CONSTRAINT [MemberLobAllocation_lobId_fkey] FOREIGN KEY ([lobId]) REFERENCES [dbo].[LineOfBusiness]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SprintMemberPlan] ADD CONSTRAINT [SprintMemberPlan_sprintId_fkey] FOREIGN KEY ([sprintId]) REFERENCES [dbo].[Sprint]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SprintMemberPlan] ADD CONSTRAINT [SprintMemberPlan_memberId_fkey] FOREIGN KEY ([memberId]) REFERENCES [dbo].[Member]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SprintPause] ADD CONSTRAINT [SprintPause_sprintId_fkey] FOREIGN KEY ([sprintId]) REFERENCES [dbo].[Sprint]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

