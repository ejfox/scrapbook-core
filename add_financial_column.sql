-- Add financial_analysis column to scraps table
ALTER TABLE scraps ADD COLUMN IF NOT EXISTS financial_analysis JSONB;

-- Add index for better performance on financial queries
CREATE INDEX IF NOT EXISTS idx_scraps_financial_analysis ON scraps USING GIN (financial_analysis);

-- Add comment for documentation
COMMENT ON COLUMN scraps.financial_analysis IS 'AI-extracted financial data including tracked assets, sentiment, and market analysis';
