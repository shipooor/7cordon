import { describe, it, expect } from 'vitest';
import { validateAIResponse, type ValidatedAIResponse } from './validate.js';

describe('validateAIResponse', () => {
  describe('Valid responses', () => {
    it('should validate a complete valid response', () => {
      // Arrange
      const response = {
        riskLevel: 'low',
        approved: true,
        explanation: 'Transaction appears safe based on on-chain data.',
        threats: [
          {
            type: 'unknown_address',
            severity: 'low',
            description: 'Destination address is new.',
          },
        ],
      };

      // Act
      const result = validateAIResponse(response);

      // Assert
      expect(result).toBeDefined();
      expect(result?.riskLevel).toBe('low');
      expect(result?.approved).toBe(true);
      expect(result?.threats).toHaveLength(1);
      expect(result?.threats[0].type).toBe('unknown_address');
    });

    it('should accept all valid risk levels', () => {
      // Arrange
      const riskLevels: Array<'safe' | 'low' | 'medium' | 'high' | 'critical'> = [
        'safe',
        'low',
        'medium',
        'high',
        'critical',
      ];

      // Act & Assert
      for (const level of riskLevels) {
        const response = {
          riskLevel: level,
          approved: true,
          explanation: 'Test',
          threats: [],
        };
        const result = validateAIResponse(response);
        expect(result).toBeDefined();
        expect(result?.riskLevel).toBe(level);
      }
    });

    it('should accept all valid threat types', () => {
      // Arrange
      const threatTypes = [
        'scam_token',
        'malicious_contract',
        'unknown_address',
        'reasoning_mismatch',
        'overspending',
        'unaudited_protocol',
        'honeypot',
        'unlimited_approval',
        'rate_limit_exceeded',
      ];

      // Act & Assert
      for (const type of threatTypes) {
        const response = {
          riskLevel: 'low',
          approved: true,
          explanation: 'Test',
          threats: [
            {
              type,
              severity: 'low',
              description: 'Test threat',
            },
          ],
        };
        const result = validateAIResponse(response);
        expect(result).toBeDefined();
        expect(result?.threats[0].type).toBe(type);
      }
    });

    it('should accept responses with empty threats array', () => {
      // Arrange
      const response = {
        riskLevel: 'safe',
        approved: true,
        explanation: 'No threats detected',
        threats: [],
      };

      // Act
      const result = validateAIResponse(response);

      // Assert
      expect(result).toBeDefined();
      expect(result?.threats).toEqual([]);
    });

    it('should handle missing threats array gracefully', () => {
      // Arrange
      const response = {
        riskLevel: 'low',
        approved: true,
        explanation: 'Transaction safe',
      };

      // Act
      const result = validateAIResponse(response);

      // Assert
      expect(result).toBeDefined();
      expect(result?.threats).toEqual([]);
    });

    it('should accept approved=true for safe risk', () => {
      // Arrange
      const response = {
        riskLevel: 'safe',
        approved: true,
        explanation: 'Safe',
        threats: [],
      };

      // Act
      const result = validateAIResponse(response);

      // Assert
      expect(result?.approved).toBe(true);
    });

    it('should accept approved=false for low risk', () => {
      // Arrange
      const response = {
        riskLevel: 'low',
        approved: false,
        explanation: 'Blocked by policy',
        threats: [],
      };

      // Act
      const result = validateAIResponse(response);

      // Assert
      expect(result?.approved).toBe(false);
    });
  });

  describe('High/Critical risk enforcement', () => {
    it('should force approved=false for high risk even if true in response', () => {
      // Arrange
      const response = {
        riskLevel: 'high',
        approved: true, // Invalid: high risk must be blocked
        explanation: 'High risk transaction',
        threats: [],
      };

      // Act
      const result = validateAIResponse(response);

      // Assert
      expect(result).toBeDefined();
      expect(result?.riskLevel).toBe('high');
      expect(result?.approved).toBe(false); // Forced to false
    });

    it('should force approved=false for critical risk', () => {
      // Arrange
      const response = {
        riskLevel: 'critical',
        approved: true,
        explanation: 'Critical risk',
        threats: [],
      };

      // Act
      const result = validateAIResponse(response);

      // Assert
      expect(result?.riskLevel).toBe('critical');
      expect(result?.approved).toBe(false);
    });

    it('should preserve approved=false for high risk', () => {
      // Arrange
      const response = {
        riskLevel: 'high',
        approved: false,
        explanation: 'Blocked',
        threats: [],
      };

      // Act
      const result = validateAIResponse(response);

      // Assert
      expect(result?.approved).toBe(false);
    });
  });

  describe('Explanation truncation', () => {
    it('should truncate explanation longer than 1000 characters', () => {
      // Arrange
      const longExplanation = 'x'.repeat(1500);
      const response = {
        riskLevel: 'low',
        approved: true,
        explanation: longExplanation,
        threats: [],
      };

      // Act
      const result = validateAIResponse(response);

      // Assert
      expect(result).toBeDefined();
      expect(result?.explanation.length).toBeLessThanOrEqual(1000);
      expect(result?.explanation).toBe('x'.repeat(1000));
    });

    it('should not truncate explanation shorter than 1000 characters', () => {
      // Arrange
      const explanation = 'Transaction safe based on analysis.';
      const response = {
        riskLevel: 'low',
        approved: true,
        explanation,
        threats: [],
      };

      // Act
      const result = validateAIResponse(response);

      // Assert
      expect(result?.explanation).toBe(explanation);
    });

    it('should handle explanation exactly 1000 characters', () => {
      // Arrange
      const explanation = 'x'.repeat(1000);
      const response = {
        riskLevel: 'low',
        approved: true,
        explanation,
        threats: [],
      };

      // Act
      const result = validateAIResponse(response);

      // Assert
      expect(result?.explanation).toBe(explanation);
      expect(result?.explanation.length).toBe(1000);
    });
  });

  describe('Threat description truncation', () => {
    it('should truncate threat description longer than 500 characters', () => {
      // Arrange
      const longDescription = 'x'.repeat(600);
      const response = {
        riskLevel: 'low',
        approved: true,
        explanation: 'Safe',
        threats: [
          {
            type: 'unknown_address',
            severity: 'low',
            description: longDescription,
          },
        ],
      };

      // Act
      const result = validateAIResponse(response);

      // Assert
      expect(result).toBeDefined();
      expect(result?.threats[0].description.length).toBeLessThanOrEqual(500);
      expect(result?.threats[0].description).toBe('x'.repeat(500));
    });

    it('should not truncate threat description shorter than 500 characters', () => {
      // Arrange
      const description = 'This is an unknown address threat.';
      const response = {
        riskLevel: 'low',
        approved: true,
        explanation: 'Safe',
        threats: [
          {
            type: 'unknown_address',
            severity: 'low',
            description,
          },
        ],
      };

      // Act
      const result = validateAIResponse(response);

      // Assert
      expect(result?.threats[0].description).toBe(description);
    });
  });

  describe('Invalid responses', () => {
    it('should return null for null input', () => {
      // Act
      const result = validateAIResponse(null);

      // Assert
      expect(result).toBeNull();
    });

    it('should return null for undefined input', () => {
      // Act
      const result = validateAIResponse(undefined);

      // Assert
      expect(result).toBeNull();
    });

    it('should return null for non-object input', () => {
      // Act
      const result1 = validateAIResponse('string');
      const result2 = validateAIResponse(123);
      const result3 = validateAIResponse(true);

      // Assert
      expect(result1).toBeNull();
      expect(result2).toBeNull();
      expect(result3).toBeNull();
    });

    it('should return null for missing riskLevel', () => {
      // Arrange
      const response = {
        approved: true,
        explanation: 'Safe',
        threats: [],
      };

      // Act
      const result = validateAIResponse(response);

      // Assert
      expect(result).toBeNull();
    });

    it('should return null for invalid riskLevel', () => {
      // Arrange
      const response = {
        riskLevel: 'unknown',
        approved: true,
        explanation: 'Safe',
        threats: [],
      };

      // Act
      const result = validateAIResponse(response);

      // Assert
      expect(result).toBeNull();
    });

    it('should return null for missing approved', () => {
      // Arrange
      const response = {
        riskLevel: 'low',
        explanation: 'Safe',
        threats: [],
      };

      // Act
      const result = validateAIResponse(response);

      // Assert
      expect(result).toBeNull();
    });

    it('should return null for non-boolean approved', () => {
      // Arrange
      const response = {
        riskLevel: 'low',
        approved: 'yes', // Should be boolean
        explanation: 'Safe',
        threats: [],
      };

      // Act
      const result = validateAIResponse(response);

      // Assert
      expect(result).toBeNull();
    });

    it('should return null for missing explanation', () => {
      // Arrange
      const response = {
        riskLevel: 'low',
        approved: true,
        threats: [],
      };

      // Act
      const result = validateAIResponse(response);

      // Assert
      expect(result).toBeNull();
    });

    it('should return null for non-string explanation', () => {
      // Arrange
      const response = {
        riskLevel: 'low',
        approved: true,
        explanation: 123,
        threats: [],
      };

      // Act
      const result = validateAIResponse(response);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('Malformed threats filtering', () => {
    it('should filter out threats with invalid type', () => {
      // Arrange
      const response = {
        riskLevel: 'low',
        approved: true,
        explanation: 'Test',
        threats: [
          {
            type: 'unknown_address',
            severity: 'low',
            description: 'Valid threat',
          },
          {
            type: 'invalid_type', // Invalid
            severity: 'low',
            description: 'Invalid threat',
          },
        ],
      };

      // Act
      const result = validateAIResponse(response);

      // Assert
      expect(result).toBeDefined();
      expect(result?.threats).toHaveLength(1);
      expect(result?.threats[0].type).toBe('unknown_address');
    });

    it('should filter out threats with invalid severity', () => {
      // Arrange
      const response = {
        riskLevel: 'low',
        approved: true,
        explanation: 'Test',
        threats: [
          {
            type: 'unknown_address',
            severity: 'low',
            description: 'Valid threat',
          },
          {
            type: 'honeypot',
            severity: 'unknown', // Invalid
            description: 'Invalid threat',
          },
        ],
      };

      // Act
      const result = validateAIResponse(response);

      // Assert
      expect(result).toBeDefined();
      expect(result?.threats).toHaveLength(1);
    });

    it('should filter out threats with missing description', () => {
      // Arrange
      const response = {
        riskLevel: 'low',
        approved: true,
        explanation: 'Test',
        threats: [
          {
            type: 'unknown_address',
            severity: 'low',
            description: 'Valid threat',
          },
          {
            type: 'honeypot',
            severity: 'high',
            // Missing description
          },
        ],
      };

      // Act
      const result = validateAIResponse(response);

      // Assert
      expect(result).toBeDefined();
      expect(result?.threats).toHaveLength(1);
    });

    it('should filter out non-object threats', () => {
      // Arrange
      const response = {
        riskLevel: 'low',
        approved: true,
        explanation: 'Test',
        threats: [
          {
            type: 'unknown_address',
            severity: 'low',
            description: 'Valid threat',
          },
          'invalid threat',
          null,
          123,
        ],
      };

      // Act
      const result = validateAIResponse(response);

      // Assert
      expect(result).toBeDefined();
      expect(result?.threats).toHaveLength(1);
    });

    it('should accept response with all invalid threats (empty threats array)', () => {
      // Arrange
      const response = {
        riskLevel: 'low',
        approved: true,
        explanation: 'Safe',
        threats: ['invalid1', 'invalid2', null],
      };

      // Act
      const result = validateAIResponse(response);

      // Assert
      expect(result).toBeDefined();
      expect(result?.threats).toEqual([]);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty explanation', () => {
      // Arrange
      const response = {
        riskLevel: 'low',
        approved: true,
        explanation: '',
        threats: [],
      };

      // Act
      const result = validateAIResponse(response);

      // Assert
      expect(result).toBeDefined();
      expect(result?.explanation).toBe('');
    });

    it('should handle explanation with special characters', () => {
      // Arrange
      const explanation = 'Test with 💀 emoji and \n newlines \t tabs';
      const response = {
        riskLevel: 'low',
        approved: true,
        explanation,
        threats: [],
      };

      // Act
      const result = validateAIResponse(response);

      // Assert
      expect(result?.explanation).toBe(explanation);
    });

    it('should not mutate input object', () => {
      // Arrange
      const original = {
        riskLevel: 'high',
        approved: true,
        explanation: 'High risk',
        threats: [],
      };
      const input = { ...original };

      // Act
      validateAIResponse(input);

      // Assert
      expect(input).toEqual(original);
    });

    it('should handle very long threat arrays', () => {
      // Arrange
      const threats = Array.from({ length: 100 }, (_, i) => ({
        type: 'unknown_address',
        severity: 'low',
        description: `Threat ${i}`,
      }));

      const response = {
        riskLevel: 'low',
        approved: true,
        explanation: 'Multiple threats',
        threats,
      };

      // Act
      const result = validateAIResponse(response);

      // Assert
      expect(result).toBeDefined();
      expect(result?.threats).toHaveLength(100);
    });

    it('should return a new object, not mutate input', () => {
      // Arrange
      const response = {
        riskLevel: 'high',
        approved: true,
        explanation: 'High',
        threats: [],
      };

      // Act
      const result = validateAIResponse(response);

      // Assert
      expect(result).not.toBe(response);
      expect(response.approved).toBe(true); // Original unchanged
      expect(result?.approved).toBe(false); // Result has corrected value
    });
  });

  describe('Type safety', () => {
    it('should return ValidatedAIResponse type when successful', () => {
      // Arrange
      const response = {
        riskLevel: 'low',
        approved: true,
        explanation: 'Safe',
        threats: [
          {
            type: 'unknown_address',
            severity: 'low',
            description: 'New address',
          },
        ],
      };

      // Act
      const result = validateAIResponse(response);

      // Assert
      if (result) {
        expect(result.riskLevel).toBeDefined();
        expect(result.approved).toBeDefined();
        expect(result.explanation).toBeDefined();
        expect(result.threats).toBeDefined();
      }
    });
  });
});
