// ───────────────────────────────────────────────────────────
  // CHANGE DISPLAY NAME (Everyone can change, unique check)
  // ───────────────────────────────────────────────────────────
  socket.on('change-display-name', async (data) => {
    try {
      const user = users.get(socket.userId);
      if (!user) return;

      const newName = data.newName.trim().substring(0, 30);
      if (!newName) {
        return socket.emit('error', 'Invalid name');
      }

      // Check if name already exists (except current user)
      for (const [id, u] of users.entries()) {
        if (id !== socket.userId && u.displayName.toLowerCase() === newName.toLowerCase()) {
          return socket.emit('error', 'Name already taken');
        }
      }

      const oldName = user.displayName;
      user.displayName = newName;
      socket.emit('action-success', `Name changed to: ${newName}`);
      
      // Update display name in current user object
      if (currentUser && socket.userId === currentUser.id) {
        currentUser.displayName = newName;
      }
      
      updateUsersList(socket.currentRoom);
      setTimeout(() => saveData(), 100);

    } catch (error) {
      console.error('❌ Change name error:', error);
    }
  });
