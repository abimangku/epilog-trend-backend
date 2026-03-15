-- Phase B: Volume Intelligence
-- Adds acceleration, saturation index, and executional feasibility columns.

-- Tier 1: Acceleration on trends
ALTER TABLE trends ADD COLUMN IF NOT EXISTS acceleration NUMERIC DEFAULT 0;

-- Tier 1: Saturation index on trends
ALTER TABLE trends ADD COLUMN IF NOT EXISTS saturation_index NUMERIC DEFAULT 0;

-- Tier 2: Executional feasibility on brand fit
ALTER TABLE client_brand_fit ADD COLUMN IF NOT EXISTS production_difficulty TEXT DEFAULT 'medium';
ALTER TABLE client_brand_fit ADD COLUMN IF NOT EXISTS production_requirements TEXT;
ALTER TABLE client_brand_fit ADD COLUMN IF NOT EXISTS estimated_production_hours NUMERIC;
ALTER TABLE client_brand_fit ADD COLUMN IF NOT EXISTS requires_original_audio BOOLEAN DEFAULT false;
