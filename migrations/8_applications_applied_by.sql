-- Add applied_by column to track who marked a job as applied.
-- Prevents duplicate applications when multiple people use Check Fit.
ALTER TABLE applications ADD COLUMN applied_by text;
