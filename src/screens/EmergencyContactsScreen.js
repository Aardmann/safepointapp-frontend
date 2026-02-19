import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  RefreshControl,
  ActivityIndicator
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { supabase } from '../services/supabase';
import * as Haptics from 'expo-haptics';

const EmergencyContactsScreen = () => {
  const [contacts, setContacts] = useState([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingContact, setEditingContact] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [user, setUser] = useState(null);
  
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    relationship: '',
    priority: 1
  });

  useEffect(() => {
    loadUserAndContacts();
  }, []);

  const loadUserAndContacts = async () => {
    try {
      setLoading(true);
      
      // Get current user
      const { data: { user: authUser } } = await supabase.auth.getUser();
      
      if (authUser) {
        setUser(authUser);
        await loadContacts(authUser.id);
      }
    } catch (error) {
      console.error('Error loading user:', error);
      Alert.alert('Error', 'Failed to load user data');
    } finally {
      setLoading(false);
    }
  };

  const loadContacts = async (userId) => {
    try {
      const { data, error } = await supabase
        .from('emergency_contacts')
        .select('*')
        .eq('user_id', userId)
        .order('priority', { ascending: true });

      if (error) throw error;
      
      setContacts(data || []);
    } catch (error) {
      console.error('Error loading contacts:', error);
      Alert.alert('Error', 'Failed to load emergency contacts');
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    loadContacts(user.id).then(() => setRefreshing(false));
  };

  const handleAddContact = () => {
    setEditingContact(null);
    setFormData({
      name: '',
      phone: '',
      email: '',
      relationship: '',
      priority: contacts.length + 1
    });
    setModalVisible(true);
  };

  const handleEditContact = (contact) => {
    setEditingContact(contact);
    setFormData({
      name: contact.name,
      phone: contact.phone,
      email: contact.email || '',
      relationship: contact.relationship || '',
      priority: contact.priority
    });
    setModalVisible(true);
  };

  const handleDeleteContact = (contact) => {
    Alert.alert(
      'Delete Contact',
      `Are you sure you want to remove ${contact.name} from emergency contacts?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteContact(contact)
        }
      ]
    );
  };

  const deleteContact = async (contact) => {
    try {
      setSaving(true);
      
      const { error } = await supabase
        .from('emergency_contacts')
        .delete()
        .eq('id', contact.id);

      if (error) throw error;

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      
      // Update local state
      setContacts(prev => prev.filter(c => c.id !== contact.id));
      
      Alert.alert('Success', 'Contact deleted successfully');
    } catch (error) {
      console.error('Error deleting contact:', error);
      Alert.alert('Error', 'Failed to delete contact');
    } finally {
      setSaving(false);
    }
  };

  const validatePhone = (phone) => {
    const phoneRegex = /^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$/;
    return phoneRegex.test(phone);
  };

  const handleSaveContact = async () => {
    // Validate
    if (!formData.name.trim()) {
      Alert.alert('Error', 'Name is required');
      return;
    }
    
    if (!formData.phone.trim()) {
      Alert.alert('Error', 'Phone number is required');
      return;
    }

    if (!validatePhone(formData.phone)) {
      Alert.alert('Error', 'Please enter a valid phone number');
      return;
    }

    try {
      setSaving(true);

      if (editingContact) {
        // Update existing contact
        const { error } = await supabase
          .from('emergency_contacts')
          .update({
            name: formData.name.trim(),
            phone: formData.phone.trim(),
            email: formData.email.trim() || null,
            relationship: formData.relationship.trim() || null,
            priority: formData.priority
          })
          .eq('id', editingContact.id);

        if (error) throw error;

        // Update local state
        setContacts(prev => prev.map(c => 
          c.id === editingContact.id 
            ? { ...c, ...formData }
            : c
        ));

        Alert.alert('Success', 'Contact updated successfully');
      } else {
        // Add new contact
        const { data, error } = await supabase
          .from('emergency_contacts')
          .insert([
            {
              user_id: user.id,
              name: formData.name.trim(),
              phone: formData.phone.trim(),
              email: formData.email.trim() || null,
              relationship: formData.relationship.trim() || null,
              priority: formData.priority
            }
          ])
          .select();

        if (error) throw error;

        // Update local state
        setContacts(prev => [...prev, data[0]]);

        Alert.alert('Success', 'Contact added successfully');
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setModalVisible(false);
      
    } catch (error) {
      console.error('Error saving contact:', error);
      Alert.alert('Error', 'Failed to save contact');
    } finally {
      setSaving(false);
    }
  };

  const handleTestAlert = (contact) => {
    Alert.alert(
      'Test Alert',
      `Send a test message to ${contact.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send Test',
          onPress: async () => {
            try {
              // Here you would call your backend to send a test SMS
              Alert.alert('Success', 'Test alert sent (simulated)');
            } catch (error) {
              Alert.alert('Error', 'Failed to send test alert');
            }
          }
        }
      ]
    );
  };

  const movePriority = async (contact, direction) => {
    const currentIndex = contacts.findIndex(c => c.id === contact.id);
    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    
    if (newIndex < 0 || newIndex >= contacts.length) return;

    const newContacts = [...contacts];
    const temp = newContacts[currentIndex];
    newContacts[currentIndex] = newContacts[newIndex];
    newContacts[newIndex] = temp;

    // Update priorities
    const updates = newContacts.map((c, index) => ({
      id: c.id,
      priority: index + 1
    }));

    try {
      setContacts(newContacts);
      
      // Update in Supabase
      for (const update of updates) {
        await supabase
          .from('emergency_contacts')
          .update({ priority: update.priority })
          .eq('id', update.id);
      }
    } catch (error) {
      console.error('Error updating priority:', error);
      // Revert on error
      loadContacts(user.id);
    }
  };

  const renderContact = ({ item, index }) => (
    <View style={styles.contactCard}>
      <View style={styles.priorityControls}>
        <TouchableOpacity 
          onPress={() => movePriority(item, 'up')}
          disabled={index === 0}
        >
          <Icon 
            name="arrow-upward" 
            size={20} 
            color={index === 0 ? '#ccc' : '#666'} 
          />
        </TouchableOpacity>
        <Text style={styles.priorityNumber}>{item.priority}</Text>
        <TouchableOpacity 
          onPress={() => movePriority(item, 'down')}
          disabled={index === contacts.length - 1}
        >
          <Icon 
            name="arrow-downward" 
            size={20} 
            color={index === contacts.length - 1 ? '#ccc' : '#666'} 
          />
        </TouchableOpacity>
      </View>

      <View style={styles.contactInfo}>
        <View style={styles.avatarContainer}>
          <Text style={styles.avatarText}>
            {item.name.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.contactDetails}>
          <Text style={styles.contactName}>{item.name}</Text>
          <Text style={styles.contactPhone}>{item.phone}</Text>
          {item.relationship && (
            <Text style={styles.contactRelationship}>{item.relationship}</Text>
          )}
        </View>
      </View>
      
      <View style={styles.contactActions}>
        <TouchableOpacity
          style={[styles.actionButton, styles.testButton]}
          onPress={() => handleTestAlert(item)}
        >
          <Icon name="notifications-active" size={18} color="#3498db" />
          <Text style={styles.testButtonText}>Test</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.actionButton, styles.editButton]}
          onPress={() => handleEditContact(item)}
        >
          <Icon name="edit" size={18} color="#f39c12" />
          <Text style={styles.editButtonText}>Edit</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.actionButton, styles.deleteButton]}
          onPress={() => handleDeleteContact(item)}
        >
          <Icon name="delete" size={18} color="#e74c3c" />
          <Text style={styles.deleteButtonText}>Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#e74c3c" />
        <Text style={styles.loadingText}>Loading contacts...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {/*<Text style={styles.headerTitle}>Emergency Contacts</Text>*/}
        <Text style={styles.headerSubtitle}>
          {contacts.length <= 1 ? 'This' : 'These'} {contacts.length} contact{contacts.length !== 1 ? 's' : ''} will be notified in case of emergency
        </Text>
      </View>

      <FlatList
        data={contacts}
        renderItem={renderContact}
        keyExtractor={item => item.id.toString()}
        contentContainerStyle={styles.listContainer}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Icon name="contacts" size={80} color="#ccc" />
            <Text style={styles.emptyText}>No emergency contacts</Text>
            <Text style={styles.emptySubtext}>
              Add contacts to notify in case of emergency
            </Text>
          </View>
        }
      />

      <TouchableOpacity 
        style={styles.addButton} 
        onPress={handleAddContact}
        disabled={saving}
      >
        <Icon name="add" size={30} color="white" />
      </TouchableOpacity>

      {/* Add/Edit Contact Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => !saving && setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingContact ? 'Edit Contact' : 'Add Emergency Contact'}
              </Text>
              <TouchableOpacity 
                onPress={() => !saving && setModalVisible(false)}
                disabled={saving}
              >
                <Icon name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.form}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Name *</Text>
                <TextInput
                  style={styles.input}
                  value={formData.name}
                  onChangeText={(text) => setFormData({...formData, name: text})}
                  placeholder="Enter contact name"
                  editable={!saving}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Phone Number *</Text>
                <TextInput
                  style={styles.input}
                  value={formData.phone}
                  onChangeText={(text) => setFormData({...formData, phone: text})}
                  placeholder="Enter phone number"
                  keyboardType="phone-pad"
                  editable={!saving}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Email (Optional)</Text>
                <TextInput
                  style={styles.input}
                  value={formData.email}
                  onChangeText={(text) => setFormData({...formData, email: text})}
                  placeholder="Enter email"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  editable={!saving}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Relationship (Optional)</Text>
                <TextInput
                  style={styles.input}
                  value={formData.relationship}
                  onChangeText={(text) => setFormData({...formData, relationship: text})}
                  placeholder="e.g., Spouse, Parent, Friend"
                  editable={!saving}
                />
              </View>

              <TouchableOpacity 
                style={[styles.saveButton, saving && styles.saveButtonDisabled]}
                onPress={handleSaveContact}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={styles.saveButtonText}>
                    {editingContact ? 'Update Contact' : 'Add Contact'}
                  </Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    color: '#666',
  },
  header: {
    padding: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 5,
  },
  listContainer: {
    padding: 15,
  },
  contactCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 15,
    marginBottom: 10,
    elevation: 2,
  },
  priorityControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginBottom: 10,
  },
  priorityNumber: {
    marginHorizontal: 10,
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  contactInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarContainer: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#e74c3c',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  avatarText: {
    color: 'white',
    fontSize: 20,
    fontWeight: 'bold',
  },
  contactDetails: {
    flex: 1,
  },
  contactName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  contactPhone: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  contactRelationship: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
    fontStyle: 'italic',
  },
  contactActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 15,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 5,
  },
  testButton: {
    backgroundColor: '#e8f4fd',
  },
  editButton: {
    backgroundColor: '#fff3e0',
  },
  deleteButton: {
    backgroundColor: '#fce4e4',
  },
  testButtonText: {
    color: '#3498db',
    marginLeft: 5,
    fontSize: 12,
    fontWeight: '500',
  },
  editButtonText: {
    color: '#f39c12',
    marginLeft: 5,
    fontSize: 12,
    fontWeight: '500',
  },
  deleteButtonText: {
    color: '#e74c3c',
    marginLeft: 5,
    fontSize: 12,
    fontWeight: '500',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 50,
  },
  emptyText: {
    fontSize: 18,
    color: '#999',
    marginTop: 20,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#ccc',
    marginTop: 5,
    textAlign: 'center',
  },
  addButton: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#e74c3c',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  form: {
    marginTop: 10,
  },
  inputGroup: {
    marginBottom: 15,
  },
  label: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  saveButton: {
    backgroundColor: '#e74c3c',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 20,
  },
  saveButtonDisabled: {
    backgroundColor: '#ccc',
  },
  saveButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default EmergencyContactsScreen;