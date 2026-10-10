// Bank game settings. All money is in thousands of Iraqi dinars (1500 = 1,500,000 IQD).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BankConfig = factory();
})(this, function () {
  return {
    MIN_PLAYERS: 2,
    // pieces a player can pick in the lobby (each one once per room)
    TOKENS: ['car', 'camel', 'palm', 'tea', 'boat', 'plane', 'dallah', 'crown'],
    MAX_PLAYERS: 6,
    START_CASH: 1500,
    GO_SALARY: 200,
    JAIL_FINE: 50,
    MAX_JAIL_TURNS: 3, // failed doubles attempts before the fine is forced
    DOUBLES_TO_JAIL: 3, // three doubles in a row
    BANK_HOUSES: 32,
    BANK_HOTELS: 12,
    HOUSES_BEFORE_HOTEL: 4,
    MORTGAGE_RATE: 0.5, // mortgage value = price * rate
    UNMORTGAGE_INTEREST: 0.1, // pay back mortgage value + 10%
    HOUSE_SELL_RATE: 0.5, // the bank buys buildings back at half price
    AUCTION_MIN_INCREMENT: 10,
    // rents: base = round(price * RENT_BASE_RATE); doubled on a full colour set without buildings
    RENT_BASE_RATE: 0.08,
    RENT_MIN: 2,
    HOUSE_MULTIPLIERS: [5, 15, 40, 55], // 1..4 houses, times the base rent
    HOTEL_MULTIPLIER: 70,
    STATION_RENTS: [25, 50, 100, 200], // owning 1..4 stations
    UTILITY_MULTIPLIERS: [4, 10], // owning 1..2 utilities, times the dice total
    HOUSE_COST_BY_GROUP: [50, 50, 100, 100, 150, 150, 200, 200], // groups 1..8
    // timers (used by the server layer; the engine itself never waits)
    TURN_SECONDS: 30,
    BUY_SECONDS: 20,
    AUCTION_SECONDS: 10,
    TRADE_SECONDS: 60,
    DEBT_SECONDS: 60,
    POST_MOVE_SECONDS: 30,
  };
});
