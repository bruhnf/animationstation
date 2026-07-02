import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { useUserStore } from '../store/useUserStore';
import { RootStackParams } from '../navigation';

interface MenuItem {
  key: string;
  label: string;
  danger?: boolean;
}

// Keep in sync with MENU_ITEMS in screens/ProfileScreen.tsx — both render the
// same real-user dropdown (this one from the feed/header, that one on Profile).
const REAL_USER_MENU_ITEMS: MenuItem[] = [
  { key: 'edit', label: 'Edit Profile' },
  { key: 'video', label: 'Animate a Photo (Video)' },
  { key: 'design', label: 'Generate an Image' },
  { key: 'closet', label: 'My Library' },
  { key: 'saved', label: 'Saved Creations' },
  { key: 'compare', label: 'Compare Creations' },
  { key: 'settings', label: 'Settings' },
  { key: 'logout', label: 'Log Out', danger: true },
];

// Guests have no profile/settings/session to manage — those screens aren't even
// registered for the guest navigator. Offer signup instead.
const GUEST_MENU_ITEMS: MenuItem[] = [{ key: 'signup', label: 'Sign Up / Log In' }];

interface HeaderMenuProps {
  title?: string;
  leftComponent?: React.ReactNode;
  rightComponent?: React.ReactNode;
  showMenu?: boolean;
  // Renders a back chevron at the far left. Use on stack screens reached from
  // the Create hub (Transform, Video) so there's always a way out.
  showBack?: boolean;
}

export default function HeaderMenu({
  title,
  leftComponent,
  rightComponent,
  showMenu = true,
  showBack = false,
}: HeaderMenuProps) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { logout, user } = useUserStore();
  const isGuest = user?.isGuest === true;
  const menuItems = isGuest ? GUEST_MENU_ITEMS : REAL_USER_MENU_ITEMS;
  const [menuVisible, setMenuVisible] = useState(false);

  function handleMenuAction(key: string) {
    setMenuVisible(false);
    if (key === 'signup') navigation.navigate('Auth', { screen: 'Signup' });
    if (key === 'edit') navigation.navigate('EditProfile');
    if (key === 'video') navigation.navigate('Video');
    if (key === 'design') navigation.navigate('Design');
    if (key === 'closet') navigation.navigate('Closet', undefined);
    if (key === 'saved') navigation.navigate('SavedLooks');
    if (key === 'compare') navigation.navigate('Compare');
    if (key === 'settings') navigation.navigate('Settings');
    if (key === 'logout') {
      Alert.alert('Log Out', 'Are you sure you want to log out?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Log Out', style: 'destructive', onPress: logout },
      ]);
    }
  }

  return (
    <>
      <View style={styles.header}>
        <View style={styles.left} pointerEvents="box-none">
          {showBack && (
            <TouchableOpacity
              onPress={() => (navigation.canGoBack() ? navigation.goBack() : null)}
              style={styles.backButton}
              hitSlop={10}
              accessibilityLabel="Go back"
            >
              <Ionicons name="chevron-back" size={26} color={Colors.textPrimary} />
            </TouchableOpacity>
          )}
          {leftComponent}
        </View>
        {title ? (
          <Text style={styles.title} pointerEvents="none">
            {title}
          </Text>
        ) : (
          <View style={styles.center} pointerEvents="none" />
        )}
        <View style={styles.right} pointerEvents="box-none">
          {rightComponent}
          {showMenu && (
            <TouchableOpacity onPress={() => setMenuVisible(true)} style={styles.menuButton}>
              <Ionicons name="ellipsis-vertical" size={22} color={Colors.textPrimary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <Modal
        transparent
        visible={menuVisible}
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          onPress={() => setMenuVisible(false)}
          activeOpacity={1}
        >
          <View style={styles.menuSheet}>
            {menuItems.map((item) => (
              <TouchableOpacity
                key={item.key}
                style={styles.menuItem}
                onPress={() => handleMenuAction(item.key)}
              >
                <Text style={[styles.menuItemText, item.danger && styles.menuItemDanger]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.gray200,
  },
  left: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  center: {
    flex: 1,
  },
  right: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  title: {
    fontSize: Typography.fontSizeXL,
    fontWeight: Typography.fontWeightBold,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  menuButton: {
    padding: Spacing.sm,
  },
  backButton: {
    paddingRight: Spacing.xs,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'flex-end',
  },
  menuSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    paddingBottom: 40,
    paddingTop: Spacing.md,
  },
  menuItem: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderBottomWidth: 1,
    borderColor: Colors.gray100,
  },
  menuItemText: {
    fontSize: Typography.fontSizeMD,
    color: Colors.textPrimary,
  },
  menuItemDanger: {
    color: Colors.danger,
  },
});
