const axios = require("axios")

// PlayFab configuration
const PLAYFAB_TITLE_ID = process.env.PLAYFAB_TITLE_ID || "1E3DA1"
const PLAYFAB_SECRET_KEY = process.env.PLAYFAB_SECRET_KEY
const PLAYFAB_BASE_URL = `https://${PLAYFAB_TITLE_ID}.playfabapi.com`
const VIRTUAL_CURRENCY_ITEM_ID = "91608f64-5945-4d59-8f4b-7b9fad6b6ea4"

/**
 * Production PlayFab Service - Generates EntityTokens server-side
 */
class PlayFabService {
  constructor() {
    this.titleId = PLAYFAB_TITLE_ID
    this.secretKey = PLAYFAB_SECRET_KEY
    this.baseUrl = PLAYFAB_BASE_URL
    this.virtualCurrencyItemId = VIRTUAL_CURRENCY_ITEM_ID
    this.entityTokenCache = new Map() // Cache tokens to avoid regenerating too frequently
  }

  /**
   * Generate EntityToken using Title Entity authentication (correct method)
   * @returns {Promise<string>} EntityToken for server operations
   */
  async generateServerEntityToken() {
    try {
      // First, we need to get the Title Entity Token using the secret key
      // This is the correct way to authenticate as the title (server)
      const response = await axios.post(
        `${this.baseUrl}/Authentication/GetEntityToken`,
        {
          // For title authentication, we need to specify the title entity
          Entity: {
            Id: this.titleId,
            Type: "title",
          },
        },
        {
          headers: {
            "Content-Type": "application/json",
            "X-SecretKey": this.secretKey,
          },
        },
      )

      if (response.data && response.data.code === 200) {
        const entityToken = response.data.data.EntityToken
        const entityId = response.data.data.Entity.Id
        const entityType = response.data.data.Entity.Type

        console.log(`✅ Generated Title EntityToken successfully`)
        console.log(`Entity ID: ${entityId}, Type: ${entityType}`)

        // Cache the token with expiration
        const expirationTime = Date.now() + 23 * 60 * 60 * 1000 // 23 hours (tokens last 24 hours)
        this.entityTokenCache.set("server", {
          token: entityToken,
          entityId: entityId,
          entityType: entityType,
          expiresAt: expirationTime,
        })

        return entityToken
      }

      throw new Error("Failed to generate Title EntityToken")
    } catch (error) {
      console.error("❌ Title EntityToken generation failed:", error.response?.data || error.message)

      // Try alternative method if the first one fails
      try {
        console.log("🔄 Trying alternative EntityToken generation method...")

        const altResponse = await axios.post(
          `${this.baseUrl}/Authentication/GetEntityToken`,
          {}, // Empty body for server authentication
          {
            headers: {
              "Content-Type": "application/json",
              "X-SecretKey": this.secretKey,
            },
          },
        )

        if (altResponse.data && altResponse.data.code === 200) {
          const entityToken = altResponse.data.data.EntityToken
          const entityId = altResponse.data.data.Entity.Id
          const entityType = altResponse.data.data.Entity.Type

          console.log(`✅ Generated EntityToken with alternative method`)
          console.log(`Entity ID: ${entityId}, Type: ${entityType}`)

          // Cache the token
          const expirationTime = Date.now() + 23 * 60 * 60 * 1000
          this.entityTokenCache.set("server", {
            token: entityToken,
            entityId: entityId,
            entityType: entityType,
            expiresAt: expirationTime,
          })

          return entityToken
        }
      } catch (altError) {
        console.error("❌ Alternative EntityToken generation also failed:", altError.response?.data || altError.message)
      }

      throw new Error(`EntityToken generation failed: ${error.response?.data?.errorMessage || error.message}`)
    }
  }

  /**
   * Get cached EntityToken or generate a new one
   * @returns {Promise<string>} Valid EntityToken
   */
  async getValidEntityToken() {
    try {
      // Check if we have a cached token that's still valid
      const cached = this.entityTokenCache.get("server")
      if (cached && cached.expiresAt > Date.now()) {
        return cached.token
      }

      // Generate new token if cache is empty or expired
      return await this.generateServerEntityToken()
    } catch (error) {
      console.error("❌ Error getting valid EntityToken:", error.message)
      throw error
    }
  }

  /**
   * Get PlayFab Entity ID from user data
   * @param {Object} user - User object from database
   * @returns {string|null} PlayFab entity ID
   */
  getPlayFabEntityId(user) {
    return user.playfabEntityId || user.playFabEntityId || user.playfab_entity_id || user.entityId || null
  }

  /**
   * Get PlayFab player ID from user data (for legacy operations)
   * @param {Object} user - User object from database
   * @returns {string|null} PlayFab player ID
   */
  getPlayFabId(user) {
    return user.playFabId || user.playfabId || user.playfab_id || null
  }

  /**
   * Add virtual currency to InventoryV2 using server-generated EntityToken
   * This replicates your successful Postman request
   * @param {Object} user - User object with PlayFab data
   * @param {number} amount - Amount of virtual currency to add
   * @param {string} reason - Reason for adding currency
   * @returns {Promise<Object>} PlayFab response data
   */
  async addVirtualCurrencyToInventory(user, amount, reason = "Payment processed") {
    try {
      console.log("💰 === ADD VIRTUAL CURRENCY TO INVENTORY V2 (Production) ===")
      console.log(`User ID: ${user._id}`)
      console.log(`Amount to ADD: ${amount}`)
      console.log(`Item ID: ${this.virtualCurrencyItemId}`)
      console.log(`Reason: ${reason}`)

      const entityId = this.getPlayFabEntityId(user)
      if (!entityId) {
        throw new Error("Missing PlayFab Entity ID for user")
      }

      console.log(`✅ Found PlayFab Entity ID: ${entityId}`)

      // Get fresh EntityToken (same as your Postman request)
      const entityToken = await this.getValidEntityToken()
      console.log(`🔑 Using EntityToken: ${entityToken.substring(0, 20)}...`)

      // Use EXACT same format as your working Postman request
      const requestPayload = {
        Entity: {
          Type: "title_player_account",
          Id: entityId,
        },
        Item: {
          Id: this.virtualCurrencyItemId,
        },
        Amount: Math.abs(Number.parseInt(amount)), // Ensure positive number for addition
      }

      console.log("📤 InventoryV2 AddInventoryItems request:")
      console.log(JSON.stringify(requestPayload, null, 2))

      // Make the exact same request as your Postman
      const response = await axios.post(`${this.baseUrl}/Inventory/AddInventoryItems`, requestPayload, {
        headers: {
          "Content-Type": "application/json",
          "X-EntityToken": entityToken, // Same header as your Postman
        },
      })

      console.log("📥 InventoryV2 AddInventoryItems response:")
      console.log(JSON.stringify(response.data, null, 2))

      if (response.data && response.data.code === 200) {
        console.log("✅ Successfully added $VIRT to InventoryV2 (Production)!")
        console.log(`✅ Added amount: ${requestPayload.Amount}`)
        console.log(`✅ Transaction IDs: ${JSON.stringify(response.data.data.TransactionIds)}`)

        return {
          success: true,
          data: response.data.data,
          method: "inventory_v2_production_addition",
          amount: requestPayload.Amount,
          itemId: this.virtualCurrencyItemId,
          transactionIds: response.data.data.TransactionIds || [],
          etag: response.data.data.ETag,
          idempotencyId: response.data.data.IdempotencyId,
        }
      }

      throw new Error(`InventoryV2 API returned code: ${response.data?.code || "unknown"}`)
    } catch (error) {
      console.error("❌ Error adding $VIRT to InventoryV2 (Production):")
      console.error("Error details:", error.response?.data || error.message)

      // Check for permission error and provide fallback
      if (error.response?.data?.errorCode === 1191) {
        const permissionError = new Error("InventoryV2 permissions not enabled")
        permissionError.code = 1191
        permissionError.isPermissionError = true
        throw permissionError
      }

      throw new Error(`Failed to add $VIRT to InventoryV2: ${error.message}`)
    }
  }

  /**
   * Remove virtual currency from InventoryV2 (for bet deductions)
   * @param {Object} user - User object with PlayFab data
   * @param {number} amount - Amount of virtual currency to remove (positive number)
   * @param {string} reason - Reason for removing currency
   * @returns {Promise<Object>} PlayFab response data
   */
  async removeVirtualCurrencyFromInventory(user, amount, reason = "Bet placed") {
    try {
      console.log("💸 === REMOVE VIRTUAL CURRENCY FROM INVENTORY V2 (Production) ===")
      console.log(`User ID: ${user._id}`)
      console.log(`Amount: ${amount}`)
      console.log(`Item ID: ${this.virtualCurrencyItemId}`)
      console.log(`Reason: ${reason}`)

      const entityId = this.getPlayFabEntityId(user)
      if (!entityId) {
        throw new Error("Missing PlayFab Entity ID for user")
      }

      // Get fresh EntityToken
      const entityToken = await this.getValidEntityToken()

      // Use SubtractInventoryItems for deductions
      const requestPayload = {
        Entity: {
          Type: "title_player_account",
          Id: entityId,
        },
        Item: {
          Id: this.virtualCurrencyItemId,
        },
        Amount: Math.abs(amount), // Ensure positive number for subtraction
      }

      console.log("📤 InventoryV2 SubtractInventoryItems request:")
      console.log(JSON.stringify(requestPayload, null, 2))
      console.log(`🔑 Using EntityToken: ${entityToken.substring(0, 20)}...`)

      const response = await axios.post(`${this.baseUrl}/Inventory/SubtractInventoryItems`, requestPayload, {
        headers: {
          "Content-Type": "application/json",
          "X-EntityToken": entityToken,
        },
      })

      console.log("📥 InventoryV2 SubtractInventoryItems response:")
      console.log(JSON.stringify(response.data, null, 2))

      if (response.data && response.data.code === 200) {
        console.log("✅ Successfully removed $VIRT from InventoryV2 (Production)!")
        return {
          success: true,
          data: response.data.data,
          method: "inventory_v2_subtraction",
          amount: -Math.abs(amount), // Return negative to indicate deduction
          itemId: this.virtualCurrencyItemId,
          transactionIds: response.data.data.TransactionIds || [],
          etag: response.data.data.ETag,
          idempotencyId: response.data.data.IdempotencyId,
        }
      }

      throw new Error(`InventoryV2 SubtractInventoryItems returned code: ${response.data?.code || "unknown"}`)
    } catch (error) {
      console.error("❌ Error removing $VIRT from InventoryV2 (Production):")
      console.error("Error details:", error.response?.data || error.message)

      // Check for permission error and provide fallback
      if (error.response?.data?.errorCode === 1191) {
        const permissionError = new Error("InventoryV2 permissions not enabled")
        permissionError.code = 1191
        permissionError.isPermissionError = true
        throw permissionError
      }

      throw new Error(`Failed to remove $VIRT from InventoryV2: ${error.message}`)
    }
  }

  /**
   * Get player's virtual currency balance from InventoryV2
   * @param {Object} user - User object from database
   * @returns {Promise<Object>} Player's inventory data
   */
  async getPlayerInventoryV2(user) {
    try {
      const entityId = this.getPlayFabEntityId(user)
      if (!entityId) {
        throw new Error("No PlayFab Entity ID found")
      }

      // Get fresh EntityToken using server secret key
      const entityToken = await this.getValidEntityToken()

      // console.log(`📋 Getting InventoryV2 data for entity ${entityId}`)
      // console.log(`🔑 Using EntityToken: ${entityToken.substring(0, 20)}...`)

      const response = await axios.post(
        `${this.baseUrl}/Inventory/GetInventoryItems`,
        {
          Entity: {
            Type: "title_player_account",
            Id: entityId,
          },
        },
        {
          headers: {
            "Content-Type": "application/json",
            "X-EntityToken": entityToken,
          },
        },
      )

      if (response.data && response.data.code === 200) {
        const inventoryItems = response.data.data.Items || []
        const virtCurrencyItem = inventoryItems.find((item) => item.Id === this.virtualCurrencyItemId)

        console.log(`Found ${inventoryItems.length} inventory items`)
        // console.log("$VIRT currency item:", virtCurrencyItem)

        return {
          success: true,
          virtualCurrencyBalance: virtCurrencyItem ? virtCurrencyItem.Amount : 0,
          allItems: inventoryItems,
          method: "inventory_v2_production",
          etag: response.data.data.ETag,
        }
      }

      throw new Error("InventoryV2 API returned unsuccessful response")
    } catch (error) {
      if (error.response?.data?.errorCode === 1191) {
        const permissionError = new Error("InventoryV2 permissions not enabled")
        permissionError.code = 1191
        permissionError.isPermissionError = true
        throw permissionError
      }

      throw new Error(`Failed to get player inventory: ${error.message}`)
    }
  }

  /**
   * Add virtual currency using Legacy API (fallback method)
   * @param {Object} user - User object with PlayFab data
   * @param {number} amount - Amount of virtual currency to add
   * @param {string} reason - Reason for adding currency
   * @returns {Promise<Object>} PlayFab response data
   */
  async addVirtualCurrencyLegacy(user, amount, reason = "Payment processed") {
    try {
      const playFabId = this.getPlayFabId(user)
      if (!playFabId) {
        throw new Error("Missing PlayFab ID")
      }

      console.log(`💰 === ADDING VIRTUAL CURRENCY (LEGACY API) ===`)
      console.log(`User ID: ${user._id}`)
      console.log(`PlayFab ID: ${playFabId}`)
      console.log(`Amount to ADD: ${amount}`)
      console.log(`Reason: ${reason}`)

      const requestPayload = {
        PlayFabId: playFabId,
        VirtualCurrency: "RT",
        Amount: Math.abs(Number.parseInt(amount)), // Ensure positive number for addition
      }

      console.log("📤 Legacy API AddUserVirtualCurrency request:")
      console.log(JSON.stringify(requestPayload, null, 2))

      const response = await axios.post(`${this.baseUrl}/Server/AddUserVirtualCurrency`, requestPayload, {
        headers: {
          "Content-Type": "application/json",
          "X-SecretKey": this.secretKey,
        },
      })

      console.log("📥 Legacy API AddUserVirtualCurrency response:")
      console.log(JSON.stringify(response.data, null, 2))

      if (response.data && response.data.code === 200) {
        console.log("✅ Successfully added RT using Legacy API!")
        console.log(`✅ New balance: ${response.data.data.Balance}`)
        console.log(`✅ Balance change: ${response.data.data.BalanceChange}`)

        return {
          success: true,
          data: response.data.data,
          method: "legacy_server_api_addition",
          amount: requestPayload.Amount,
          currencyCode: "RT",
          balance: response.data.data.Balance,
          balanceChange: response.data.data.BalanceChange,
        }
      }

      throw new Error(`Legacy API returned code: ${response.data?.code || "unknown"}`)
    } catch (error) {
      console.error("❌ Error adding virtual currency (Legacy):", error.response?.data || error.message)
      throw new Error(`Failed to add virtual currency (Legacy): ${error.message}`)
    }
  }

  /**
   * Subtract virtual currency using Legacy API (fallback method)
   * @param {Object} user - User object with PlayFab data
   * @param {number} amount - Amount of virtual currency to subtract
   * @param {string} reason - Reason for subtracting currency
   * @returns {Promise<Object>} PlayFab response data
   */
  async subtractVirtualCurrencyLegacy(user, amount, reason = "Bet placed") {
    try {
      const playFabId = this.getPlayFabId(user)
      if (!playFabId) {
        throw new Error("Missing PlayFab ID")
      }

      console.log(`💸 Subtracting ${amount} RT using Legacy API for PlayFab ID: ${playFabId}`)

      const requestPayload = {
        PlayFabId: playFabId,
        VirtualCurrency: "RT",
        Amount: -Math.abs(amount), // Negative amount for subtraction
      }

      const response = await axios.post(`${this.baseUrl}/Server/AddUserVirtualCurrency`, requestPayload, {
        headers: {
          "Content-Type": "application/json",
          "X-SecretKey": this.secretKey,
        },
      })

      if (response.data && response.data.code === 200) {
        console.log("✅ Successfully subtracted RT using Legacy API!")
        return {
          success: true,
          data: response.data.data,
          method: "legacy_server_api_subtraction",
          amount: -Math.abs(amount),
          currencyCode: "RT",
          balance: response.data.data.Balance,
          balanceChange: response.data.data.BalanceChange,
        }
      }

      throw new Error(`Legacy API returned code: ${response.data?.code || "unknown"}`)
    } catch (error) {
      throw new Error(`Failed to subtract virtual currency (Legacy): ${error.message}`)
    }
  }

  /**
   * Process payment to PlayFab (main function - handles both additions and deductions)
   * @param {Object} user - User object with PlayFab data
   * @param {number} amount - Payment amount (positive for addition, negative for deduction)
   * @param {string} paymentId - Payment ID for tracking
   * @param {Object} paymentData - Additional payment data
   * @returns {Promise<Object>} Processing result
   */
  async processPaymentToPlayFab(user, amount, paymentId, paymentData = {}) {
    try {
      console.log("💰 === PROCESS PAYMENT TO PLAYFAB (Production) ===")
      console.log(`Amount: ${amount} (${amount > 0 ? "ADDITION" : "SUBTRACTION"})`)
      console.log(`User: ${user._id}`)
      console.log(`Payment ID: ${paymentId}`)

      // Determine if this is an addition or subtraction
      const isAddition = amount > 0
      const absoluteAmount = Math.abs(amount)

      // Try InventoryV2 first (preferred method)
      try {
        console.log(`🎯 Attempting InventoryV2 ${isAddition ? "addition" : "subtraction"} (Production)...`)

        let result
        if (isAddition) {
          // Add virtual currency
          result = await this.addVirtualCurrencyToInventory(
            user,
            absoluteAmount,
            `${paymentData.source || "Payment"} - ID: ${paymentId}`,
          )
        } else {
          // Remove virtual currency
          result = await this.removeVirtualCurrencyFromInventory(
            user,
            absoluteAmount,
            `${paymentData.source || "Deduction"} - ID: ${paymentId}`,
          )
        }

        console.log(`✅ InventoryV2 ${isAddition ? "addition" : "subtraction"} successful (Production)`)
        return {
          success: true,
          playFabResult: result,
          amount,
          paymentId,
          userId: user._id,
          timestamp: new Date().toISOString(),
          operation: isAddition ? "addition" : "subtraction",
        }
      } catch (inventoryV2Error) {
        console.log(`❌ InventoryV2 ${isAddition ? "addition" : "subtraction"} failed:`, inventoryV2Error.message)

        // Fall back to Legacy API if InventoryV2 fails due to permissions
        if (inventoryV2Error.isPermissionError || inventoryV2Error.code === 1191) {
          console.log("🔄 InventoryV2 permissions not enabled, falling back to Legacy Virtual Currency API...")
          try {
            let legacyResult
            if (isAddition) {
              legacyResult = await this.addVirtualCurrencyLegacy(
                user,
                absoluteAmount,
                `${paymentData.source || "Payment"} - ID: ${paymentId}`,
              )
            } else {
              legacyResult = await this.subtractVirtualCurrencyLegacy(
                user,
                absoluteAmount,
                `${paymentData.source || "Deduction"} - ID: ${paymentId}`,
              )
            }

            console.log(`✅ Legacy API ${isAddition ? "addition" : "subtraction"} successful`)
            return {
              success: true,
              playFabResult: legacyResult,
              amount,
              paymentId,
              userId: user._id,
              timestamp: new Date().toISOString(),
              operation: isAddition ? "addition" : "subtraction",
            }
          } catch (legacyError) {
            console.log(`❌ Legacy API ${isAddition ? "addition" : "subtraction"} also failed:`, legacyError.message)
            return {
              success: false,
              error: `Both InventoryV2 and Legacy ${isAddition ? "addition" : "subtraction"} failed. InventoryV2: ${inventoryV2Error.message}, Legacy: ${legacyError.message}`,
              amount,
              paymentId,
              userId: user._id,
              timestamp: new Date().toISOString(),
            }
          }
        } else {
          return {
            success: false,
            error: inventoryV2Error.message,
            amount,
            paymentId,
            userId: user._id,
            timestamp: new Date().toISOString(),
          }
        }
      }
    } catch (error) {
      console.error("❌ Error in processPaymentToPlayFab:", error.message)
      return {
        success: false,
        error: error.message,
        amount,
        paymentId,
        userId: user._id,
        timestamp: new Date().toISOString(),
      }
    }
  }

  /**
   * Get player inventory (main function - tries InventoryV2 first, falls back to Legacy)
   * @param {Object} user - User object from database
   * @returns {Promise<Object>} Player's inventory data
   */
  async getPlayerInventory(user) {
    try {
      // Try InventoryV2 first (preferred method)
      try {
        const result = await this.getPlayerInventoryV2(user)
        return result
      } catch (inventoryV2Error) {
        // Fall back to Legacy API if InventoryV2 fails due to permissions
        if (inventoryV2Error.isPermissionError || inventoryV2Error.code === 1191) {
          try {
            const legacyResult = await this.getPlayerVirtualCurrencyLegacy(user)
            return legacyResult
          } catch (legacyError) {
            throw new Error(
              `Both InventoryV2 and Legacy API failed. InventoryV2: ${inventoryV2Error.message}, Legacy: ${legacyError.message}`,
            )
          }
        } else {
          throw inventoryV2Error
        }
      }
    } catch (error) {
      console.error("❌ Error in getPlayerInventory:", error.message)
      throw error
    }
  }

  /**
   * Get player's virtual currency balance using Legacy API
   * @param {Object} user - User object from database
   * @returns {Promise<Object>} Player's currency balance
   */
  async getPlayerVirtualCurrencyLegacy(user) {
    try {
      const playFabId = this.getPlayFabId(user)
      if (!playFabId) {
        throw new Error("No PlayFab ID found")
      }

      const response = await axios.post(
        `${this.baseUrl}/Server/GetUserInventory`,
        {
          PlayFabId: playFabId,
        },
        {
          headers: {
            "Content-Type": "application/json",
            "X-SecretKey": this.secretKey,
          },
        },
      )

      if (response.data && response.data.code === 200) {
        const virtualCurrency = response.data.data.VirtualCurrency || {}
        const balance = virtualCurrency["RT"] || 0

        return {
          success: true,
          virtualCurrencyBalance: balance,
          allCurrencies: virtualCurrency,
          method: "legacy_server_api",
        }
      }

      throw new Error("Legacy API returned unsuccessful response")
    } catch (error) {
      throw new Error(`Failed to get virtual currency balance: ${error.message}`)
    }
  }

  /**
   * Validate PlayFab configuration
   * @returns {boolean} True if configuration is valid
   */
  isConfigured() {
    return !!(this.titleId && this.secretKey)
  }

  /**
   * Clear token cache (useful for testing)
   */
  clearTokenCache() {
    this.entityTokenCache.clear()
  }
}

// Create singleton instance
const playFabService = new PlayFabService()

module.exports = playFabService
