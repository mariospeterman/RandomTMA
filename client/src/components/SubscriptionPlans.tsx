import { useState } from 'react';
import { useTonConnect } from '../hooks/useTonConnect';
import { useTelegramTon } from '../hooks/use-telegram-ton';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Loader2, Check, X, Wallet, DollarSign } from 'lucide-react';
import { useToast } from '../hooks/use-toast';
import { SUBSCRIPTION_AMOUNT_MONTHLY, SUBSCRIPTION_AMOUNT_YEARLY } from '../lib/env';

export default function SubscriptionPlans() {
  const { toast } = useToast();
  const { telegramUser } = useTelegramTon();
  const { 
    connected: isWalletConnected, 
    isTestnet,
    showWalletConnectModal,
    subscribeUser
  } = useTonConnect();
  
  const [isProcessing, setIsProcessing] = useState<{[key: string]: boolean}>({
    monthly: false,
    yearly: false
  });
  
  // Handle subscription purchase
  const handleSubscribe = async (plan: 'monthly' | 'yearly') => {
    if (!isWalletConnected) {
      toast({
        title: "Wallet Required",
        description: "Please connect your TON wallet first",
        variant: "default"
      });
      
      try {
        await showWalletConnectModal();
      } catch (err) {
        console.error("Failed to open wallet modal:", err);
      }
      
      return;
    }
    
    // Set processing state for this plan
    setIsProcessing(prev => ({ ...prev, [plan]: true }));
    
    try {
      // Create a unique comment with user ID if available
      const userComment = telegramUser 
        ? `${plan} subscription for user ${telegramUser.id}`
        : `${plan} subscription`;
        
      // Subscribe the user
      const success = await subscribeUser({
        plan,
        comment: userComment,
        callback: (success, txHash, expiryDate) => {
          if (success) {
            // Format the expiry date
            const formattedDate = expiryDate 
              ? expiryDate.toLocaleDateString() 
              : 'Unknown';
              
            toast({
              title: "Subscription Successful!",
              description: `Your ${plan} subscription is active until ${formattedDate}`,
              variant: "default",
              duration: 5000
            });
            
            // You would typically call an API here to register the subscription in your backend
            console.log(`Subscription successful. Plan: ${plan}, TxHash: ${txHash}, Expires: ${formattedDate}`);
          } else {
            toast({
              title: "Subscription Failed",
              description: "There was a problem processing your payment",
              variant: "destructive"
            });
          }
        }
      });
      
      if (!success) {
        toast({
          title: "Subscription Failed",
          description: "Transaction was not completed",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error(`Error subscribing to ${plan} plan:`, error);
      
      toast({
        title: "Error",
        description: "An error occurred while processing your subscription",
        variant: "destructive"
      });
    } finally {
      setIsProcessing(prev => ({ ...prev, [plan]: false }));
    }
  };
  
  return (
    <div className="container mx-auto py-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">Subscription Plans</h2>
          
          {isTestnet && (
            <Badge variant="outline" className="bg-yellow-900/20 text-yellow-300 border-yellow-800">
              Testnet Mode
            </Badge>
          )}
        </div>
        
        <p className="text-gray-400">
          Choose a subscription plan to unlock premium features and support our development.
        </p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
          {/* Monthly Plan */}
          <Card className="bg-gray-800 border-gray-700 overflow-hidden relative">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-600/5 to-blue-400/10"></div>
            <CardHeader className="relative z-10">
              <CardTitle className="text-xl">Monthly Subscription</CardTitle>
              <CardDescription>Perfect for casual users</CardDescription>
            </CardHeader>
            <CardContent className="relative z-10">
              <div className="mb-4">
                <p className="text-3xl font-bold">{SUBSCRIPTION_AMOUNT_MONTHLY} TON</p>
                <p className="text-sm text-gray-400">per month</p>
              </div>
              
              <ul className="space-y-2">
                <li className="flex items-center">
                  <Check className="h-5 w-5 text-green-500 mr-2" />
                  <span>Premium support</span>
                </li>
                <li className="flex items-center">
                  <Check className="h-5 w-5 text-green-500 mr-2" />
                  <span>Early access to new features</span>
                </li>
                <li className="flex items-center">
                  <X className="h-5 w-5 text-gray-500 mr-2" />
                  <span className="text-gray-500">Priority access</span>
                </li>
              </ul>
            </CardContent>
            <CardFooter className="relative z-10">
              <Button 
                onClick={() => handleSubscribe('monthly')} 
                disabled={isProcessing.monthly || !isWalletConnected}
                className="w-full bg-blue-600 hover:bg-blue-700"
              >
                {isProcessing.monthly ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : !isWalletConnected ? (
                  <>
                    <Wallet className="mr-2 h-4 w-4" />
                    Connect Wallet
                  </>
                ) : (
                  <>
                    <DollarSign className="mr-2 h-4 w-4" />
                    Subscribe Monthly
                  </>
                )}
              </Button>
            </CardFooter>
          </Card>
          
          {/* Yearly Plan */}
          <Card className="bg-gray-800 border-gray-700 overflow-hidden relative">
            <div className="absolute inset-0 bg-gradient-to-br from-purple-600/5 to-purple-400/10"></div>
            <div className="absolute top-0 right-0">
              <Badge className="rounded-bl-md rounded-tr-md rounded-br-none rounded-tl-none bg-purple-700 text-white border-0">
                Best Value
              </Badge>
            </div>
            <CardHeader className="relative z-10">
              <CardTitle className="text-xl">Yearly Subscription</CardTitle>
              <CardDescription>For our dedicated users</CardDescription>
            </CardHeader>
            <CardContent className="relative z-10">
              <div className="mb-4">
                <p className="text-3xl font-bold">{SUBSCRIPTION_AMOUNT_YEARLY} TON</p>
                <p className="text-sm text-gray-400">per year</p>
              </div>
              
              <ul className="space-y-2">
                <li className="flex items-center">
                  <Check className="h-5 w-5 text-green-500 mr-2" />
                  <span>Premium support</span>
                </li>
                <li className="flex items-center">
                  <Check className="h-5 w-5 text-green-500 mr-2" />
                  <span>Early access to new features</span>
                </li>
                <li className="flex items-center">
                  <Check className="h-5 w-5 text-green-500 mr-2" />
                  <span>Priority access</span>
                </li>
              </ul>
            </CardContent>
            <CardFooter className="relative z-10">
              <Button 
                onClick={() => handleSubscribe('yearly')} 
                disabled={isProcessing.yearly || !isWalletConnected}
                className="w-full bg-purple-600 hover:bg-purple-700"
              >
                {isProcessing.yearly ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : !isWalletConnected ? (
                  <>
                    <Wallet className="mr-2 h-4 w-4" />
                    Connect Wallet
                  </>
                ) : (
                  <>
                    <DollarSign className="mr-2 h-4 w-4" />
                    Subscribe Yearly
                  </>
                )}
              </Button>
            </CardFooter>
          </Card>
        </div>
        
        <p className="text-sm text-gray-500 mt-4">
          All payments are processed on the TON blockchain.
          {isTestnet && " Currently running in testnet mode. No real TON will be spent."}
        </p>
      </div>
    </div>
  );
} 