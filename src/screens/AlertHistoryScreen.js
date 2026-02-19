import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Alert
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { supabase } from '../services/supabase';

const AlertHistoryScreen = () => {
  const [alerts, setAlerts] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // 'all', 'active', 'resolved'
  const [stats, setStats] = useState({
    total: 0,
    active: 0,
    resolved: 0
  });

  useEffect(() => {
    loadAlerts();
  }, [filter]);

  const loadAlerts = async () => {
    try {
      setLoading(true);
      
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) return;

      let query = supabase
        .from('emergency_alerts')
        .select(`
          *,
          alert_recipients (
            id,
            name,
            phone,
            delivered,
            read_at
          )
        `)
        .eq('user_id', user.id)
        .order('timestamp', { ascending: false });

      if (filter !== 'all') {
        query = query.eq('status', filter);
      }

      const { data, error } = await query;

      if (error) throw error;

      setAlerts(data || []);

      // Calculate stats
      const total = data?.length || 0;
      const active = data?.filter(a => a.status === 'active').length || 0;
      const resolved = data?.filter(a => a.status === 'resolved').length || 0;

      setStats({ total, active, resolved });

    } catch (error) {
      console.error('Error loading alerts:', error);
      Alert.alert('Error', 'Failed to load alert history');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    loadAlerts().then(() => setRefreshing(false));
  };

  const resolveAlert = async (alertId) => {
    Alert.alert(
      'Resolve Alert',
      'Mark this alert as resolved?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Resolve',
          onPress: async () => {
            try {
              const { error } = await supabase
                .from('emergency_alerts')
                .update({ 
                  status: 'resolved',
                  resolved_at: new Date().toISOString()
                })
                .eq('id', alertId);

              if (error) throw error;

              // Update local state
              setAlerts(prev => prev.map(a => 
                a.id === alertId 
                  ? { ...a, status: 'resolved', resolved_at: new Date().toISOString() }
                  : a
              ));

              // Update stats
              setStats(prev => ({
                ...prev,
                active: prev.active - 1,
                resolved: prev.resolved + 1
              }));

              Alert.alert('Success', 'Alert marked as resolved');
            } catch (error) {
              console.error('Error resolving alert:', error);
              Alert.alert('Error', 'Failed to resolve alert');
            }
          }
        }
      ]
    );
  };

  const getGestureIcon = (type) => {
    const icons = {
      shake: 'vibration',
      volume_buttons: 'volume-up',
      power_button_five: 'power-settings-new',
      all_buttons: 'dialpad',
      back_tap: 'touch-app',
      sos_motion: 'gesture',
      screen_cover: 'screen-lock-portrait',
      fall_detection: 'warning',
      silent_scream: 'mic-off',
      manual: 'panic-button'
    };
    return icons[type] || 'warning';
  };

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    
    return date.toLocaleDateString();
  };

  const renderAlert = ({ item }) => (
    <TouchableOpacity 
      style={[styles.alertCard, item.status === 'active' && styles.activeAlert]}
      onPress={() => {
        Alert.alert(
          'Alert Details',
          `Trigger: ${item.trigger_type.replace(/_/g, ' ')}\n` +
          `Time: ${new Date(item.timestamp).toLocaleString()}\n` +
          `Location: ${item.location_address || 'Unknown'}\n` +
          `Status: ${item.status}\n` +
          `Recipients: ${item.alert_recipients?.length || 0} notified`,
          [{ text: 'OK' }]
        );
      }}
    >
      <View style={styles.alertHeader}>
        <View style={styles.alertIconContainer}>
          <Icon name={getGestureIcon(item.trigger_type)} size={24} color="#e74c3c" />
        </View>
        <View style={styles.alertTypeContainer}>
          <Text style={styles.alertType}>
            {item.trigger_type.replace(/_/g, ' ').toUpperCase()}
          </Text>
          <View style={[
            styles.statusBadge,
            { backgroundColor: 
              item.status === 'active' ? '#e74c3c' : 
              item.status === 'resolved' ? '#2ecc71' : '#f39c12'
            }
          ]}>
            <Text style={styles.statusText}>{item.status}</Text>
          </View>
        </View>
        <Text style={styles.alertTime}>{formatDate(item.timestamp)}</Text>
      </View>
      
      {item.location_address && (
        <View style={styles.locationContainer}>
          <Icon name="location-on" size={16} color="#666" />
          <Text style={styles.locationText} numberOfLines={1}>
            {item.location_address}
          </Text>
        </View>
      )}

      {item.alert_recipients && item.alert_recipients.length > 0 && (
        <View style={styles.recipientsContainer}>
          <Icon name="notifications" size={14} color="#666" />
          <Text style={styles.recipientsText}>
            {item.alert_recipients.length} contact{item.alert_recipients.length > 1 ? 's' : ''} notified
          </Text>
        </View>
      )}

      {item.status === 'active' && (
        <TouchableOpacity 
          style={styles.resolveButton}
          onPress={() => resolveAlert(item.id)}
        >
          <Text style={styles.resolveButtonText}>Mark as Resolved</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );

  const FilterButton = ({ title, value }) => (
    <TouchableOpacity
      style={[styles.filterButton, filter === value && styles.filterButtonActive]}
      onPress={() => setFilter(value)}
    >
      <Text style={[styles.filterText, filter === value && styles.filterTextActive]}>
        {title}
      </Text>
    </TouchableOpacity>
  );

  if (loading && !refreshing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#e74c3c" />
        <Text style={styles.loadingText}>Loading alert history...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {/*<Text style={styles.headerTitle}>Alert History</Text>*/}
        <Text style={styles.headerSubtitle}>Your past emergency alerts</Text>
      </View>

      {/* Stats Cards */}
      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{stats.total}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
        <View style={[styles.statCard, styles.activeStatCard]}>
          <Text style={styles.statNumber}>{stats.active}</Text>
          <Text style={styles.statLabel}>Active</Text>
        </View>
        <View style={[styles.statCard, styles.resolvedStatCard]}>
          <Text style={styles.statNumber}>{stats.resolved}</Text>
          <Text style={styles.statLabel}>Resolved</Text>
        </View>
      </View>

      {/* Filter Buttons */}
      <View style={styles.filterContainer}>
        <FilterButton title="All" value="all" />
        <FilterButton title="Active" value="active" />
        <FilterButton title="Resolved" value="resolved" />
      </View>

      <FlatList
        data={alerts}
        renderItem={renderAlert}
        keyExtractor={item => item.id.toString()}
        contentContainerStyle={styles.listContainer}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Icon name="history" size={80} color="#ccc" />
            <Text style={styles.emptyText}>No alerts found</Text>
            <Text style={styles.emptySubtext}>
              {filter === 'all' 
                ? 'Your emergency alerts will appear here'
                : `No ${filter} alerts at this time`}
            </Text>
          </View>
        }
      />
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
  statsContainer: {
    flexDirection: 'row',
    padding: 15,
    justifyContent: 'space-around',
  },
  statCard: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    minWidth: 100,
    elevation: 2,
  },
  activeStatCard: {
    backgroundColor: '#fff3e0',
  },
  resolvedStatCard: {
    backgroundColor: '#e8f5e9',
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 5,
  },
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: 15,
    marginBottom: 10,
  },
  filterButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginHorizontal: 5,
    borderRadius: 20,
    backgroundColor: '#fff',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  filterButtonActive: {
    backgroundColor: '#e74c3c',
    borderColor: '#e74c3c',
  },
  filterText: {
    color: '#666',
    fontSize: 12,
  },
  filterTextActive: {
    color: '#fff',
  },
  listContainer: {
    padding: 15,
  },
  alertCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 15,
    marginBottom: 10,
    elevation: 2,
  },
  activeAlert: {
    borderLeftWidth: 4,
    borderLeftColor: '#e74c3c',
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  alertIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fce4e4',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  alertTypeContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  alertType: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginLeft: 10,
  },
  statusText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  alertTime: {
    fontSize: 11,
    color: '#999',
  },
  locationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    padding: 8,
    borderRadius: 5,
    marginBottom: 8,
  },
  locationText: {
    fontSize: 12,
    color: '#666',
    marginLeft: 5,
    flex: 1,
  },
  recipientsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
  },
  recipientsText: {
    fontSize: 11,
    color: '#999',
    marginLeft: 5,
  },
  resolveButton: {
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#e8f5e9',
    borderRadius: 5,
    alignItems: 'center',
  },
  resolveButtonText: {
    color: '#2ecc71',
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
});

export default AlertHistoryScreen;