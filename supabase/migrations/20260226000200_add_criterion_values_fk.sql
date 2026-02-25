-- Add FK constraint from criterion_values to criteria table
-- Applied after verifying all existing criterion_id values exist in criteria table

ALTER TABLE criterion_values
  ADD CONSTRAINT fk_criterion_values_criterion
  FOREIGN KEY (criterion_id) REFERENCES criteria(id) ON DELETE CASCADE;
