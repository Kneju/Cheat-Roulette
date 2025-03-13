const socket = io();
let currentGameId = null;
let currentPlayerName = null;
let myPlayerId = null;
let gameState = {
    players: [],
    tableCard: null,
    currentTurn: null,
    myHand: [],
    lastPlay: null,
    canCallLiar: false,
    selectedCards: [],

    // Card image settings
    useCardImages: true, // Set to true to use card images instead of CSS styling
    cardImages: {
      Ace: '/images/decks/default/ace.png', // Replace with your actual image path 
      King: '/images/decks/default/king.png',
      Queen: '/images/decks/default/queen.png',
      Joker: '/images/decks/default/joker.png',
      Back: '/images/decks/default/back.png'
    }
    
  };


  
// DOM Elements Cache
const elements = {
  joinBtn: document.getElementById('joinGameBtn'),
  startBtn: document.getElementById('startGameBtn'),
  playCardsBtn: document.getElementById('playCardsBtn'),
  callLiarBtn: document.getElementById('callLiarBtn'),
  pullTriggerBtn: document.getElementById('pullTriggerBtn'),
  playerNameInput: document.getElementById('playerName'),
  gameIdInput: document.getElementById('gameId'),
  cardCountInput: document.getElementById('cardCount'),
  lobby: document.getElementById('lobby'),
  game: document.getElementById('game'),
  playersList: document.getElementById('players'),
  handCards: document.getElementById('handCards'),
  opponentsArea: document.getElementById('opponentsArea'),
  tableCard: document.getElementById('tableCard'),
  currentTurnPlayer: document.getElementById('currentTurnPlayer'),
  playedCards: document.getElementById('playedCards'),
  lastPlayInfo: document.getElementById('lastPlayInfo'),
  gameMessages: document.getElementById('gameMessages'),
  rouletteArea: document.getElementById('rouletteArea'),
  chamber: document.getElementById('chamber'), 
  chatInput: document.getElementById('chatInput'),
  sendChatBtn: document.getElementById('sendChatBtn'),
  chatMessages: document.getElementById('chatMessages'),
};

// Join game when button is clicked
elements.joinBtn.addEventListener('click', () => {
  currentPlayerName = elements.playerNameInput.value.trim();
  currentGameId = elements.gameIdInput.value.trim() || 'game123';
  
  if (!currentPlayerName) {
    alert('Please enter your name');
    return;
  }
  
  myPlayerId = socket.id;
  socket.emit('joinGame', { gameId: currentGameId, playerName: currentPlayerName });
});

// Listen for lobby updates
socket.on('lobbyUpdate', (data) => {
  // Update player list
  elements.playersList.innerHTML = '';
  data.players.forEach(player => {
    const li = document.createElement('li');
    li.textContent = player.name;
    if (player.id === data.hostId) {
      li.textContent += ' (Host)';
    }
    elements.playersList.appendChild(li);
  });
  
  // Show start button if you're the host
  if (socket.id === data.hostId) {
    elements.startBtn.style.display = 'block';
  } else {
    elements.startBtn.style.display = 'none';
  }
  
  // Update game state
  gameState.players = data.players;
});

// Start game listener
elements.startBtn.addEventListener('click', () => {
  socket.emit('startGame', currentGameId);
});

// Handle deck style changes
document.getElementById('deckStyle').addEventListener('change', function() {
    const deckStyle = this.value;
    
    if (deckStyle === 'css') {
      // Use CSS-based cards instead of images
      gameState.useCardImages = false;
    } else {
      // Use card images
      gameState.useCardImages = true;
      
      // Update image paths based on selected deck
      gameState.cardImages = {
        Ace: `/images/decks/${deckStyle}/ace.png`,
        King: `/images/decks/${deckStyle}/king.png`,
        Queen: `/images/decks/${deckStyle}/queen.png`,
        Joker: `/images/decks/${deckStyle}/joker.png`,
        Back: `/images/decks/${deckStyle}/card_back.png`
      };
    }
    
    // Redraw cards if game is in progress
    if (gameState.myHand && gameState.myHand.length > 0) {
      displayHand(gameState.myHand);
    }
    
    // Redraw played cards if any are on the table
    if (gameState.lastPlay && gameState.lastPlay.cardCount > 0) {
      displayPlayedCards(gameState.lastPlay.cardCount);
    }
  });


// Game started event
socket.on('gameStarted', (data) => {
  // Hide lobby and show game view
  elements.lobby.style.display = 'none';
  elements.game.style.display = 'block';
  
  // Update game state
  gameState.tableCard = data.tableCard;
  gameState.players = data.players;
  gameState.currentTurn = data.currentTurn;
  
  // Display table card
  elements.tableCard.textContent = data.tableCard;
  
  // Display players
  updatePlayersDisplay();
  
  // Display your own hand
  if (data.yourHand) {
    gameState.myHand = data.yourHand;
    displayHand(data.yourHand);
  }
  
  // Show who's turn it is
  updateTurnDisplay();
  
  addGameMessage(`Game started! The table card is ${data.tableCard}.`);
});

// New round event handler
socket.on('newRound', (data) => {
  // Update game state
  gameState.tableCard = data.tableCard;
  gameState.players = data.players;
  gameState.currentTurn = data.currentTurn;
  gameState.lastPlay = null;
  gameState.selectedCards = [];
  
  // Update UI
  elements.tableCard.textContent = data.tableCard;
  elements.playedCards.innerHTML = '';
  elements.lastPlayInfo.textContent = '';
  
  // Display players
  updatePlayersDisplay();
  
  // Display your own hand
  if (data.yourHand) {
    gameState.myHand = data.yourHand;
    displayHand(data.yourHand);
  }
  
  // Show who's turn it is
  updateTurnDisplay();
  
  addGameMessage(`New round started! The table card is now ${data.tableCard}.`);
});

// Player turn update
socket.on('turnUpdate', (data) => {
  gameState.currentTurn = data.currentTurn;
  gameState.canCallLiar = data.canCallLiar || false;
  
  updateTurnDisplay();
  updateActionButtons();
  
  if (data.currentTurn === socket.id) {
    addGameMessage("It's your turn!");
  }
});

// Cards played by another player
socket.on('cardsPlayed', (data) => {
  gameState.lastPlay = {
    playerId: data.playerId,
    cardCount: data.cardCount,
    cards: []  // The actual cards are hidden until potentially revealed
  };
  
  // Update UI to show face-down cards
  displayPlayedCards(data.cardCount);
  
  // Update who can call liar - ONLY the next player can call liar
  gameState.canCallLiar = data.nextPlayerId === socket.id;
  elements.callLiarBtn.disabled = !gameState.canCallLiar;
  
  // Update messages
  const playerName = getPlayerNameById(data.playerId);
  addGameMessage(`${playerName} played ${data.cardCount} card(s), claiming they are ${gameState.tableCard}s.`);
  elements.lastPlayInfo.textContent = `${playerName} claimed: ${data.cardCount} ${gameState.tableCard}(s)`;
});

// Liar called result
socket.on('liarCalled', (data) => {
  // Show the cards that were played
  displayRevealedCards(data.playedCards);
  
  const accuserName = getPlayerNameById(data.accuserId);
  const accusedName = getPlayerNameById(data.accusedId);
  
  if (data.wasTruthful) {
    addGameMessage(`${accuserName} called ${accusedName} a liar, but ${accusedName} was telling the truth! ${accuserName} must play roulette.`);
    
    if (data.accuserId === socket.id) {
      // Show roulette for the accuser (you)
      showRoulette(data.rouletteCount);
    }
  } else {
    addGameMessage(`${accuserName} called ${accusedName} a liar and was right! ${accusedName} was lying and must play roulette.`);
    
    if (data.accusedId === socket.id) {
      // Show roulette for the accused (you)
      showRoulette(data.rouletteCount);
    }
  }
});

// Roulette result
socket.on('rouletteResult', (data) => {
  const playerName = getPlayerNameById(data.playerId);
  
  if (data.survived) {
    addGameMessage(`${playerName} survived the roulette! (Chamber ${data.chamber}/6)`);
  } else {
    addGameMessage(`${playerName} did not survive the roulette. They are out of the game.`);
  }
  
  // Hide roulette UI if it was your turn
  if (data.playerId === socket.id) {
    elements.rouletteArea.style.display = 'none';
  }
  
  // Update player's roulette count
  updatePlayerRouletteCounts(data.playerId, data.rouletteCount);
});

// Game over
socket.on('gameOver', (data) => {
  const winnerName = getPlayerNameById(data.winnerId);
  addGameMessage(`Game over! ${winnerName} is the winner!`);
  
  // Disable all game controls
  elements.playCardsBtn.disabled = true;
  elements.callLiarBtn.disabled = true;
  elements.pullTriggerBtn.disabled = true;
});

// Handler for selecting cards from hand
function selectCard(cardElem) {
  // Toggle selection
  cardElem.classList.toggle('selected');
  
  // Update selected cards array
  const cardIndex = parseInt(cardElem.dataset.index);
  const cardValue = gameState.myHand[cardIndex];
  
  if (cardElem.classList.contains('selected')) {
    gameState.selectedCards.push({ index: cardIndex, value: cardValue });
  } else {
    gameState.selectedCards = gameState.selectedCards.filter(card => card.index !== cardIndex);
  }
  
  // Enable/disable play button based on selection
  elements.playCardsBtn.disabled = gameState.selectedCards.length === 0 || 
                                  gameState.currentTurn !== socket.id;
}

// Play cards button handler
elements.playCardsBtn.addEventListener('click', () => {
  const cardCount = parseInt(elements.cardCountInput.value);
  
  if (gameState.selectedCards.length !== cardCount) {
    alert(`Please select exactly ${cardCount} card(s).`);
    return;
  }
  
  // Extract just the card values to send
  const cardIndices = gameState.selectedCards.map(card => card.index);
  const cardValues = gameState.selectedCards.map(card => card.value);
  
  // Send play to server
  socket.emit('playCards', {
    gameId: currentGameId,
    cardIndices: cardIndices,
    cardCount: cardCount
  });
  
  // Remove played cards from hand
  removeCardsFromHand(cardIndices);
  
  // Clear selection
  gameState.selectedCards = [];
});

// Call liar button handler
elements.callLiarBtn.addEventListener('click', () => {
  if (!gameState.lastPlay) return;
  
  socket.emit('callLiar', {
    gameId: currentGameId,
    accusedPlayerId: gameState.lastPlay.playerId
  });
  
  // Disable button after calling
  elements.callLiarBtn.disabled = true;
});

// Pull trigger button handler
elements.pullTriggerBtn.addEventListener('click', () => {
    socket.emit('pullTrigger', { gameId: currentGameId });
    // Hide the button instead of disabling it
    elements.pullTriggerBtn.style.display = 'none';
});


// Chat messages 

// Send chat message when button is clicked
elements.sendChatBtn.addEventListener('click', () => {
  sendChatMessage();
});

// Send chat message when Enter key is pressed
elements.chatInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    sendChatMessage();
  }
});

// Function to send chat message
function sendChatMessage() {
  const message = elements.chatInput.value.trim();
  if (message) {
    socket.emit('chatMessage', {
      gameId: currentGameId,
      message: message,
      sender: currentPlayerName
    });
    elements.chatInput.value = '';
  }
}

// Socket event to receive chat messages
socket.on('chatMessage', (data) => {
  const isMyMessage = data.senderId === socket.id;
  addChatMessage(data.sender, data.message, isMyMessage);
});

// Function to add a chat message to the chat box
function addChatMessage(sender, message, isMyMessage = false) {
  const messageElem = document.createElement('div');
  messageElem.className = `chat-message ${isMyMessage ? 'my-message' : ''}`;
  
  const usernameSpan = document.createElement('span');
  usernameSpan.className = 'chat-username';
  usernameSpan.textContent = sender + ': ';
  
  messageElem.appendChild(usernameSpan);
  messageElem.appendChild(document.createTextNode(message));
  
  elements.chatMessages.appendChild(messageElem);
  
  // Auto-scroll to bottom
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}









// Helper Functions

// Display the player's hand
function displayHand(cards) {
  elements.handCards.innerHTML = ''; // Clear previous cards
  
  cards.forEach((card, index) => {
    const cardElem = document.createElement('div');
    cardElem.className = 'card';
    cardElem.dataset.index = index;
    cardElem.dataset.value = card;
    
    if (gameState.useCardImages && gameState.cardImages[card]) {
      // Use images for cards
      const cardImg = document.createElement('img');
      cardImg.src = gameState.cardImages[card];
      cardImg.alt = card;
      cardImg.className = 'card-image';
      cardElem.appendChild(cardImg);
    } else {
      // Create the card content with CSS styling
      const cardInner = document.createElement('div');
      cardInner.className = 'card-inner';
      
      // Create top part (rank and suit)
      const cardTop = document.createElement('div');
      cardTop.className = 'card-top';
      
      // Create center part (large symbol)
      const cardCenter = document.createElement('div');
      cardCenter.className = 'card-center';
      
      // Create bottom part (inverted rank and suit)
      const cardBottom = document.createElement('div');
      cardBottom.className = 'card-bottom';
      
      // Set the content based on card type
      if (card === 'Ace') {
        cardTop.textContent = 'A';
        cardCenter.textContent = '♠';
        cardBottom.textContent = 'A';
        cardElem.classList.add('card-black');
      } else if (card === 'King') {
        cardTop.textContent = 'K';
        cardCenter.textContent = '♥';
        cardBottom.textContent = 'K';
        cardElem.classList.add('card-red');
      } else if (card === 'Queen') {
        cardTop.textContent = 'Q';
        cardCenter.textContent = '♣';
        cardBottom.textContent = 'Q';
        cardElem.classList.add('card-black');
      } else if (card === 'Joker') {
        cardTop.textContent = 'J';
        cardCenter.textContent = '★';
        cardBottom.textContent = 'J';
        cardElem.classList.add('card-red');
      }
      
      // Assemble the card
      cardInner.appendChild(cardTop);
      cardInner.appendChild(cardCenter);
      cardInner.appendChild(cardBottom);
      cardElem.appendChild(cardInner);
    }
    
    // Add click handler
    cardElem.addEventListener('click', () => selectCard(cardElem));
    
    // Add to hand
    elements.handCards.appendChild(cardElem);
  });
}

// Show face-down cards in the center
function displayPlayedCards(count) {
  elements.playedCards.innerHTML = '';
  
  for (let i = 0; i < count; i++) {
    const cardElem = document.createElement('div');
    cardElem.className = 'card card-back';
    
    if (gameState.useCardImages && gameState.cardImages.Back) {
      // Use card back image
      const cardImg = document.createElement('img');
      cardImg.src = gameState.cardImages.Back;
      cardImg.alt = 'Card Back';
      cardImg.className = 'card-image';
      cardElem.appendChild(cardImg);
    }
    
    elements.playedCards.appendChild(cardElem);
  }
}

// Show revealed cards when liar is called
function displayRevealedCards(cards) {
  elements.playedCards.innerHTML = '';
  
  cards.forEach(card => {
    const cardElem = document.createElement('div');
    cardElem.className = 'card';
    
    if (gameState.useCardImages && gameState.cardImages[card]) {
      // Use images for cards
      const cardImg = document.createElement('img');
      cardImg.src = gameState.cardImages[card];
      cardImg.alt = card;
      cardImg.className = 'card-image';
      cardElem.appendChild(cardImg);
    } else {
      // Create the card content with CSS styling
      const cardInner = document.createElement('div');
      cardInner.className = 'card-inner';
      
      // Create top part (rank and suit)
      const cardTop = document.createElement('div');
      cardTop.className = 'card-top';
      
      // Create center part (large symbol)
      const cardCenter = document.createElement('div');
      cardCenter.className = 'card-center';
      
      // Create bottom part (inverted rank and suit)
      const cardBottom = document.createElement('div');
      cardBottom.className = 'card-bottom';
      
      // Set the content based on card type
      if (card === 'Ace') {
        cardTop.textContent = 'A';
        cardCenter.textContent = '♠';
        cardBottom.textContent = 'A';
        cardElem.classList.add('card-black');
      } else if (card === 'King') {
        cardTop.textContent = 'K';
        cardCenter.textContent = '♥';
        cardBottom.textContent = 'K';
        cardElem.classList.add('card-red');
      } else if (card === 'Queen') {
        cardTop.textContent = 'Q';
        cardCenter.textContent = '♣';
        cardBottom.textContent = 'Q';
        cardElem.classList.add('card-black');
      } else if (card === 'Joker') {
        cardTop.textContent = 'J';
        cardCenter.textContent = '★';
        cardBottom.textContent = 'J';
        cardElem.classList.add('card-red');
      }
      
      // Assemble the card
      cardInner.appendChild(cardTop);
      cardInner.appendChild(cardCenter);
      cardInner.appendChild(cardBottom);
      cardElem.appendChild(cardInner);
    }
    
    elements.playedCards.appendChild(cardElem);
  });
}

// Update the display of all players
function updatePlayersDisplay() {
  elements.opponentsArea.innerHTML = '';
  
  gameState.players.forEach(player => {
    // Skip yourself - your info is shown separately
    if (player.id === socket.id) return;
    
    const playerSlot = document.createElement('div');
    playerSlot.className = 'player-slot';
    if (player.id === gameState.currentTurn) {
      playerSlot.classList.add('current-turn');
    }
    
    const playerName = document.createElement('div');
    playerName.className = 'player-name';
    playerName.textContent = player.name;
    
    const cardCount = document.createElement('div');
    cardCount.className = 'player-card-count';
    cardCount.textContent = `Cards: ${player.cardCount || 5}`;
    
    const rouletteInfo = document.createElement('div');
    rouletteInfo.className = 'player-roulette';
    rouletteInfo.textContent = player.rouletteCount ? `Roulette: ${player.rouletteCount}/6` : '';
    
    playerSlot.appendChild(playerName);
    playerSlot.appendChild(cardCount);
    playerSlot.appendChild(rouletteInfo);
    elements.opponentsArea.appendChild(playerSlot);
  });
}

// Update current turn display
function updateTurnDisplay() {
  const currentPlayerName = getPlayerNameById(gameState.currentTurn);
  elements.currentTurnPlayer.textContent = currentPlayerName;
  
  // Update action buttons based on whose turn it is
  updateActionButtons();
  
  // Update player highlights
  updatePlayersDisplay();
}

// Update game action buttons
function updateActionButtons() {
  const isMyTurn = gameState.currentTurn === socket.id;
  
  elements.playCardsBtn.disabled = !isMyTurn || gameState.selectedCards.length === 0;
  elements.callLiarBtn.disabled = !gameState.canCallLiar;
}

// Remove cards from hand after playing them
function removeCardsFromHand(indices) {
  // Sort indices in descending order to avoid index shifting issues
  indices.sort((a, b) => b - a);
  
  // Remove cards from hand
  indices.forEach(index => {
    gameState.myHand.splice(index, 1);
  });
  
  // Redisplay hand
  displayHand(gameState.myHand);
}

// Show roulette interface
function showRoulette(rouletteCount) {
    elements.rouletteArea.style.display = 'block';
    elements.chamber.textContent = rouletteCount + 1; // Chambers start at 1
    
    // Make sure the button is visible and enabled when showing the roulette
    elements.pullTriggerBtn.style.display = 'block';
    elements.pullTriggerBtn.disabled = false;
    
    addGameMessage(`It's your turn to play roulette. Chamber ${rouletteCount + 1}/6.`);
  }

// Update player's roulette count
function updatePlayerRouletteCounts(playerId, count) {
  gameState.players.forEach(player => {
    if (player.id === playerId) {
      player.rouletteCount = count;
    }
  });
  updatePlayersDisplay();
}

// Add a message to the game log
function addGameMessage(message) {
  const messageElem = document.createElement('div');
  messageElem.textContent = message;
  elements.gameMessages.appendChild(messageElem);
  
  // Auto-scroll to bottom
  elements.gameMessages.scrollTop = elements.gameMessages.scrollHeight;
}

// Get player name by ID
function getPlayerNameById(playerId) {
  const player = gameState.players.find(p => p.id === playerId);
  return player ? player.name : 'Unknown Player';
}