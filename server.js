// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files from the 'public' folder
app.use(express.static('public'));

// Game state storage
let games = {}; // to store game state

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // Handle joining a game
  socket.on('joinGame', ({ gameId, playerName }) => {
    socket.join(gameId);
    
    // Create new game if it doesn't exist
    if (!games[gameId]) {
      games[gameId] = {
        players: [],
        hostId: socket.id, // first player becomes the host
        deck: [],
        currentTurn: null,
        tableCard: null,
        lastPlay: null,
        canCallLiar: false,
        gameStarted: false,
        roundHistory: []
      };
    }
    
    const game = games[gameId];
    
    // Check if game already started
    if (game.gameStarted) {
      socket.emit('error', { message: 'Game already started, cannot join.' });
      return;
    }
    
    // Add player with initial data
    game.players.push({ 
      id: socket.id, 
      name: playerName, 
      hand: [], 
      rouletteCount: 0,
      alive: true 
    });
    
    // Broadcast updated lobby information
    io.to(gameId).emit('lobbyUpdate', { 
      players: game.players.map(p => ({ id: p.id, name: p.name })), 
      hostId: game.hostId 
    });
    
    console.log(`${playerName} (${socket.id}) joined game ${gameId}`);
  });

  // Handle starting a game
  socket.on('startGame', (gameId) => {
    let game = games[gameId];
    
    // Verify game exists and hasn't started
    if (!game || game.gameStarted) return;
    if (game.players.length < 2) {
      socket.emit('error', { message: 'Need at least 2 players to start.' });
      return;
    }
    
    game.gameStarted = true;
  
    // Build and shuffle deck
    game.deck = buildDeck();
    shuffleDeck(game.deck);
  
    // Deal cards (each player gets 5)
    game.players.forEach(player => {
      player.hand = game.deck.splice(0, 5);
    });
    
    // Set the table card randomly
    game.tableCard = chooseTableCard();
    
    // Set first player randomly
    game.currentTurn = game.players[Math.floor(Math.random() * game.players.length)].id;
    
    // Send game state to all players
    game.players.forEach(player => {
      // Send full game state with this player's hand
      io.to(player.id).emit('gameStarted', { 
        tableCard: game.tableCard, 
        players: game.players.map(p => ({
          id: p.id,
          name: p.name,
          cardCount: p.hand.length,
          rouletteCount: p.rouletteCount,
          alive: p.alive
        })),
        currentTurn: game.currentTurn,
        yourHand: player.hand
      });
    });
    
    console.log(`Game ${gameId} started. Table card: ${game.tableCard}`);
  });

  // Handle a player's move (playing cards)
  socket.on('playCards', ({ gameId, cardIndices, cardCount }) => {
    let game = games[gameId];
    if (!game || !game.gameStarted) return;
    
    // Verify it's the player's turn
    if (game.currentTurn !== socket.id) {
      socket.emit('error', { message: "Not your turn!" });
      return;
    }
    
    // Find the player
    const playerIndex = game.players.findIndex(p => p.id === socket.id);
    if (playerIndex === -1) return;
    
    const player = game.players[playerIndex];
    
    // Verify the player has enough cards
    if (cardIndices.length !== cardCount || cardIndices.length > player.hand.length) {
      socket.emit('error', { message: "Invalid card selection" });
      return;
    }
    
    // Extract the cards being played
    const playedCards = cardIndices.map(index => player.hand[index]);
    
    // Remove cards from player's hand (in reverse order to avoid index shifting)
    cardIndices.sort((a, b) => b - a).forEach(index => {
      player.hand.splice(index, 1);
    });
    
    // Find the next alive player
    let nextPlayerIndex = (playerIndex + 1) % game.players.length;
    while (!game.players[nextPlayerIndex].alive || game.players[nextPlayerIndex].id === socket.id) {
      nextPlayerIndex = (nextPlayerIndex + 1) % game.players.length;
    }
    
    const nextPlayerId = game.players[nextPlayerIndex].id;
    
    // Save the played cards for evaluation if called a liar later
    game.lastPlay = {
      playerId: socket.id,
      cards: playedCards,
      cardCount: cardCount
    };
    
    // Broadcast the move to all players
    io.to(gameId).emit('cardsPlayed', { 
      playerId: socket.id, 
      cardCount: cardCount,
      nextPlayerId: nextPlayerId
    });
    
    // Update turn
    game.currentTurn = nextPlayerId;
    game.canCallLiar = true;
    
    // Notify the next player it's their turn
    io.to(gameId).emit('turnUpdate', { 
      currentTurn: game.currentTurn, 
      canCallLiar: nextPlayerId === nextPlayerId 
    });
    
    console.log(`Player ${player.name} played ${cardCount} cards`);
  });

  // Handle calling "liar"
  socket.on('callLiar', ({ gameId, accusedPlayerId }) => {
    let game = games[gameId];
    if (!game || !game.gameStarted || !game.lastPlay) return;
    
    // Verify the last play was from the accused
    if (game.lastPlay.playerId !== accusedPlayerId) {
      socket.emit('error', { message: "Can only call liar on the last player" });
      return;
    }
    
    // Evaluate the truth
    const playedCards = game.lastPlay.cards;
    const validCards = ['Joker', game.tableCard]; // Jokers count as the table card
    const wasTruthful = playedCards.every(card => validCards.includes(card));
    
    // Determine who plays roulette
    let roulettePlayerId;
    if (wasTruthful) {
      // Accuser plays roulette
      roulettePlayerId = socket.id;
    } else {
      // Accused plays roulette
      roulettePlayerId = accusedPlayerId;
    }
    
    // Broadcast the result
    io.to(gameId).emit('liarCalled', { 
      accuserId: socket.id, 
      accusedId: accusedPlayerId, 
      playedCards: playedCards, 
      wasTruthful: wasTruthful,
      roulettePlayerId: roulettePlayerId,
      rouletteCount: getPlayerRoulette(game, roulettePlayerId)
    });
    
    // Reset last play
    game.lastPlay = null;
    
    console.log(`${getPlayerName(game, socket.id)} called ${getPlayerName(game, accusedPlayerId)} a liar. Was truthful: ${wasTruthful}`);
  });

  // Handle pulling the trigger in roulette
  socket.on('pullTrigger', ({ gameId }) => {
    let game = games[gameId];
    if (!game || !game.gameStarted) return;
    
    // Find the player
    const playerIndex = game.players.findIndex(p => p.id === socket.id);
    if (playerIndex === -1) return;
    
    const player = game.players[playerIndex];
    
    // Increment roulette count
    player.rouletteCount++;
    
    // Calculate survival chance (1 in (6 - rouletteCount + 1))
    const chambers = 6;
    const currentChamber = player.rouletteCount;
    
    // Determine if player survives
    let survived = true;
    
    if (currentChamber >= chambers) {
      // Last chamber - guaranteed death
      survived = false;
    } else {
      // Random chance based on remaining chambers
      survived = Math.random() >= (1 / (chambers - currentChamber + 1));
    }
    
    // Update player state if they didn't survive
    if (!survived) {
      player.alive = false;
    }
    
    // Broadcast the result
    io.to(gameId).emit('rouletteResult', {
      playerId: socket.id,
      survived: survived,
      chamber: currentChamber,
      rouletteCount: player.rouletteCount
    });
    
    console.log(`${player.name} pulled the trigger. Survived: ${survived}. Chamber: ${currentChamber}/6`);
    
    // Check if game is over (only one player alive)
    const alivePlayers = game.players.filter(p => p.alive);
    if (alivePlayers.length <= 1 && alivePlayers.length > 0) {
      // Game over - we have a winner
      io.to(gameId).emit('gameOver', {
        winnerId: alivePlayers[0].id
      });
      console.log(`Game ${gameId} over. Winner: ${alivePlayers[0].name}`);
      return;
    }
    
    // After roulette, we need to reshuffle and start a new round
    reshuffleAndStartNewRound(game, survived ? socket.id : null);
    
    // If player died, handle next turn
    if (!survived) {
      // Find the next alive player
      let nextPlayerIndex = (playerIndex + 1) % game.players.length;
      while (!game.players[nextPlayerIndex].alive) {
        nextPlayerIndex = (nextPlayerIndex + 1) % game.players.length;
      }
      
      // Set the next player's turn
      game.currentTurn = game.players[nextPlayerIndex].id;
      game.canCallLiar = false;
      
      // Notify all players of the turn change
      io.to(gameId).emit('turnUpdate', { 
        currentTurn: game.currentTurn, 
        canCallLiar: false 
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    // Find games this player was in
    for (const gameId in games) {
      const game = games[gameId];
      const playerIndex = game.players.findIndex(p => p.id === socket.id);
      
      if (playerIndex !== -1) {
        // If game hasn't started yet, remove the player
        if (!game.gameStarted) {
          // If the host leaves, assign a new host
          if (game.hostId === socket.id && game.players.length > 1) {
            game.hostId = game.players.find(p => p.id !== socket.id).id;
          }
          
          // Remove the player
          game.players.splice(playerIndex, 1);
          
          // If no players left, delete the game
          if (game.players.length === 0) {
            delete games[gameId];
            console.log(`Game ${gameId} deleted - all players left`);
            continue;
          }
          
          // Update the lobby
          io.to(gameId).emit('lobbyUpdate', { 
            players: game.players.map(p => ({ id: p.id, name: p.name })), 
            hostId: game.hostId 
          });
        } else {
          // If game is in progress, mark player as disconnected/dead
          game.players[playerIndex].alive = false;
          
          // If it was their turn, move to next player
          if (game.currentTurn === socket.id) {
            // Find the next alive player
            let nextPlayerIndex = (playerIndex + 1) % game.players.length;
            while (!game.players[nextPlayerIndex].alive) {
              nextPlayerIndex = (nextPlayerIndex + 1) % game.players.length;
            }
            
            // Set the next player's turn
            game.currentTurn = game.players[nextPlayerIndex].id;
            game.canCallLiar = false;
            
            // Notify all players of the turn change
            io.to(gameId).emit('turnUpdate', { 
              currentTurn: game.currentTurn, 
              canCallLiar: false 
            });
          }
          
          // Check if game is over
          const alivePlayers = game.players.filter(p => p.alive);
          if (alivePlayers.length <= 1 && alivePlayers.length > 0) {
            // Game over - we have a winner
            io.to(gameId).emit('gameOver', {
              winnerId: alivePlayers[0].id
            });
            console.log(`Game ${gameId} over. Winner: ${alivePlayers[0].name}`);
          }
        }
      }
    }
  });
});

// Helper functions
function buildDeck() {
  let deck = [];
  deck.push(...Array(6).fill('Ace'));
  deck.push(...Array(6).fill('King'));
  deck.push(...Array(6).fill('Queen'));
  deck.push(...Array(2).fill('Joker'));
  return deck;
}

function shuffleDeck(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
}

function chooseTableCard() {
  // Randomly choose one of the three values
  const options = ['Ace', 'King', 'Queen'];
  return options[Math.floor(Math.random() * options.length)];
}

function getPlayerRoulette(game, playerId) {
  const player = game.players.find(p => p.id === playerId);
  return player ? player.rouletteCount : 0;
}

function getPlayerName(game, playerId) {
  const player = game.players.find(p => p.id === playerId);
  return player ? player.name : 'Unknown Player';
}

// Function to reshuffle cards and start a new round
function reshuffleAndStartNewRound(game, firstPlayerId) {
  // Collect all cards back
  game.deck = [];
  game.players.forEach(player => {
    if (player.alive) {
      // Only collect cards from alive players
      game.deck = game.deck.concat(player.hand);
      player.hand = [];
    }
  });
  
  // Add any played cards back to the deck
  if (game.lastPlay && game.lastPlay.cards) {
    game.deck = game.deck.concat(game.lastPlay.cards);
  }
  
  // If we don't have enough cards, rebuild the deck
  if (game.deck.length < game.players.filter(p => p.alive).length * 5) {
    game.deck = buildDeck();
  }
  
  // Shuffle the deck
  shuffleDeck(game.deck);
  
  // Deal cards to alive players (5 each)
  game.players.forEach(player => {
    if (player.alive) {
      player.hand = game.deck.splice(0, 5);
    }
  });
  
  // Set a new table card
  game.tableCard = chooseTableCard();
  
  // Set first player (either the survivor of roulette or a random player if none specified)
  if (firstPlayerId) {
    game.currentTurn = firstPlayerId;
  } else {
    const alivePlayers = game.players.filter(p => p.alive);
    if (alivePlayers.length > 0) {
      game.currentTurn = alivePlayers[Math.floor(Math.random() * alivePlayers.length)].id;
    }
  }
  
  // Reset round state
  game.lastPlay = null;
  game.canCallLiar = false;
  
  // Send updated game state to all players
  game.players.forEach(player => {
    if (player.alive) {
      // Send full game state with this player's hand
      io.to(player.id).emit('newRound', { 
        tableCard: game.tableCard, 
        players: game.players.map(p => ({
          id: p.id,
          name: p.name,
          cardCount: p.alive ? p.hand.length : 0,
          rouletteCount: p.rouletteCount,
          alive: p.alive
        })),
        currentTurn: game.currentTurn,
        yourHand: player.hand
      });
    }
  });
  
  console.log(`New round started in game. Table card: ${game.tableCard}`);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));